// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * BermDistributorV1 — a box that pays a fixed list and cannot be talked out of it.
 *
 * WHAT IT PROMISES, exactly:
 *
 *   Once the quote asset is in this contract, the split is fixed by `root` and
 *   nobody can redirect a single wei of it. Not the deployer, not Berm, not Bags.
 *
 * WHAT IT DOES NOT PROMISE, stated here rather than in a footnote: nothing forces
 * anyone to fund it, and nothing stops the upstream fee source from changing.
 * Both are disclosed in SOVEREIGNTY.md. This contract governs what happens after
 * the money arrives, and that is the whole of its claim.
 *
 * THERE IS NO ADMIN. No owner, no pause, no upgrade, no sweep, no rescue, no
 * deadline, no expiry. Those are not omissions to be added later — a function
 * that can move subscriber funds is the thing this exists to not have. Wanting a
 * different split means deploying a different contract.
 *
 * THE PAYOUT IS THE QUOTE ASSET, and that is deliberate. An earlier design routed
 * every claim through a swap. That makes a claim succeed only if a market
 * succeeds: an illiquid or paused pool would leave a subscriber unable to take
 * anything at all, from a contract whose entire point is that their share cannot
 * be withheld. Anyone who wants the token can swap what they receive, in whatever
 * venue they like, at whatever moment they choose.
 */

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * The Bags fee share on Robinhood. Verified against
 * `bagsfm/bags-idl/robinhood-abi-v2/BagsFeeShare.json`.
 *
 * Only `claim` is used. `getClaimers` and `owner` are declared so a reader can
 * check the binding themselves without trusting our prose: after a correct launch
 * `getClaimers()` names this contract and `owner()` is the zero address, which is
 * what makes `setClaimers` permanently unreachable.
 */
interface IBagsFeeShare {
    function claim(bool unwrap) external;
    function getClaimers() external view returns (address[] memory, uint16[] memory);
    function owner() external view returns (address);
}

contract BermDistributorV1 {
    /* ---------------------------------------------------------------- *
     * Immutable state. All of it. There is no other kind here except the
     * two counters, and neither of those is settable.
     * ---------------------------------------------------------------- */

    /// Merkle root over the entitlement set. Fixed at deployment, forever.
    bytes32 public immutable root;

    /// Denominator of the weight ranges. The leaves must tile `[0, totalWeight)`.
    uint256 public immutable totalWeight;

    /// The asset paid out. WETH on Robinhood.
    IERC20 public immutable quote;

    /// The Bags fee share this campaign harvests from. May be zero for a
    /// manually funded campaign, in which case `harvest` is permanently unusable.
    IBagsFeeShare public immutable feeShare;

    /// Binds every leaf to this campaign, so a proof cannot be replayed against
    /// another deployment that happens to share a subtree.
    bytes32 public immutable campaignId;

    /**
     * Ceiling on proof length.
     *
     * 32 levels is 4.29 billion leaves — far past any real roster, and past the
     * point where the gas to build such a tree exceeds any chain's block limit.
     * It is a bound on an unbounded loop, not a defence against a forgery: no
     * keccak256 second preimage is known. Unbounded input into a fixed-gas
     * function is its own problem regardless.
     */
    uint256 public constant MAX_PROOF_DEPTH = 32;

    /// Domain separators. A leaf hash can never be read as an interior node.
    bytes1 private constant LEAF_DOMAIN = 0x00;
    bytes1 private constant NODE_DOMAIN = 0x01;

    /* ---------------------------------------------------------------- */

    /// Cumulative quote units this contract has ever paid out.
    uint256 public totalDistributed;

    /// Cumulative quote units each slot has received.
    mapping(uint256 => uint256) public paidTo;

    /* ---------------------------------------------------------------- */

    event Claimed(uint256 indexed index, address indexed wallet, bytes32 npub, uint256 amount);
    event Harvested(uint256 amount);

    error ZeroRoot();
    error ZeroWeight();
    error ZeroQuote();
    error BadRange();
    error ProofTooLong();
    error BadProof();
    error NothingToClaim();
    error TransferFailed();
    error NoFeeShare();

    /* ---------------------------------------------------------------- */

    constructor(
        bytes32 _root,
        uint256 _totalWeight,
        address _quote,
        address _feeShare,
        bytes32 _campaignId
    ) {
        if (_root == bytes32(0)) revert ZeroRoot();
        if (_totalWeight == 0) revert ZeroWeight();
        if (_quote == address(0)) revert ZeroQuote();

        root = _root;
        totalWeight = _totalWeight;
        quote = IERC20(_quote);
        feeShare = IBagsFeeShare(_feeShare);
        campaignId = _campaignId;
    }

    /* ---------------------------------------------------------------- *
     * Accounting
     * ---------------------------------------------------------------- */

    /**
     * Every quote unit this campaign has ever recognised.
     *
     * DERIVED, NOT STORED, and that is the whole trick. `claim` moves `amount`
     * out of the balance and adds the same `amount` to `totalDistributed`, so
     * this sum is unchanged by any claim. A transfer in — a harvest, a donation,
     * anyone sending WETH here by hand — raises it. Nothing lowers it.
     *
     * So it is monotonic by construction rather than by an invariant somebody has
     * to maintain, and there is no `sync` function, no `totalReceived` variable,
     * and no way for the two to disagree. Donations are simply counted, which is
     * the honest behaviour: money in this contract belongs to the roster.
     */
    function grossReceived() public view returns (uint256) {
        return quote.balanceOf(address(this)) + totalDistributed;
    }

    /**
     * What a range is owed against all revenue to date.
     *
     * Contiguous ranges telescope: summed over leaves that tile
     * `[0, totalWeight)`, these terms collapse to exactly `grossReceived()`. No
     * rounding dust, and therefore no dust recipient to argue about. Flooring
     * each share independently would lose up to one wei per claimant and leave
     * somebody to decide who gets the crumbs.
     *
     * A caller may pass any range. Passing one that is not in the tree is
     * pointless — `claim` verifies membership before it pays.
     */
    function entitlement(uint256 rangeStart, uint256 rangeEnd) public view returns (uint256) {
        uint256 g = grossReceived();
        return (g * rangeEnd) / totalWeight - (g * rangeStart) / totalWeight;
    }

    /// What this slot could take right now.
    function claimable(
        uint256 index,
        uint256 rangeStart,
        uint256 rangeEnd
    ) public view returns (uint256) {
        uint256 owed = entitlement(rangeStart, rangeEnd);
        uint256 had = paidTo[index];
        return owed > had ? owed - had : 0;
    }

    /* ---------------------------------------------------------------- *
     * Claiming
     * ---------------------------------------------------------------- */

    /**
     * Pay a slot everything it is owed and has not yet received.
     *
     * PERMISSIONLESS ON PURPOSE. The destination is committed inside the leaf, so
     * a stranger calling this can only send your money to you, and pays the gas
     * for the privilege. That is what makes a subscriber with an empty wallet
     * still able to be paid, and what makes "the dev refused to process my claim"
     * impossible rather than merely unlikely.
     *
     * Callable again whenever more revenue has arrived. There is no deadline and
     * nothing expires.
     *
     * REENTRANCY. State is written before the transfer, and that alone is
     * sufficient: on a reentrant call `paidTo[index]` already equals the new
     * total, and `grossReceived()` is unchanged because the balance fell by
     * exactly what `totalDistributed` rose by. The second call computes zero and
     * reverts. No guard variable is needed, and one would only hide the fact that
     * the ordering is what protects us.
     */
    function claim(
        uint256 index,
        bytes32 npub,
        address wallet,
        uint256 rangeStart,
        uint256 rangeEnd,
        bytes32[] calldata proof
    ) external {
        if (rangeEnd <= rangeStart || rangeEnd > totalWeight) revert BadRange();
        if (proof.length > MAX_PROOF_DEPTH) revert ProofTooLong();

        bytes32 node = leafHash(index, npub, wallet, rangeStart, rangeEnd);
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 sib = proof[i];
            node = node < sib
                ? keccak256(abi.encodePacked(NODE_DOMAIN, node, sib))
                : keccak256(abi.encodePacked(NODE_DOMAIN, sib, node));
        }
        if (node != root) revert BadProof();

        uint256 amount = claimable(index, rangeStart, rangeEnd);
        if (amount == 0) revert NothingToClaim();

        paidTo[index] += amount;
        totalDistributed += amount;

        if (!quote.transfer(wallet, amount)) revert TransferFailed();
        emit Claimed(index, wallet, npub, amount);
    }

    /**
     * The committed leaf hash.
     *
     * `abi.encode` rather than `abi.encodePacked`: every field is padded to 32
     * bytes, so no two different tuples can produce the same preimage. Packed
     * encoding of variable-width fields is how ambiguous-leaf bugs are born.
     *
     * The 0x00 prefix is what stops a leaf from ever being read as an interior
     * node, which is the second-preimage attack this shape exists to prevent.
     */
    function leafHash(
        uint256 index,
        bytes32 npub,
        address wallet,
        uint256 rangeStart,
        uint256 rangeEnd
    ) public view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                LEAF_DOMAIN,
                abi.encode(campaignId, index, npub, wallet, rangeStart, rangeEnd)
            )
        );
    }

    /* ---------------------------------------------------------------- *
     * Harvest
     * ---------------------------------------------------------------- */

    /**
     * Pull whatever the Bags fee share owes this contract.
     *
     * Permissionless, and it needs to be nothing more than this. Because
     * `grossReceived()` reads the balance, harvested revenue is recognised the
     * moment it lands — no delta to record, no counter to keep in step, no way
     * for the accounting to drift from the money.
     *
     * `unwrap = false` keeps WETH. Native ETH would arrive through `receive`,
     * which this contract deliberately does not have, so unwrapping would revert
     * and strand the claim.
     *
     * The delta is emitted rather than required to be positive. A harvest that
     * finds nothing is a wasted transaction, not an error, and reverting on it
     * would let a griefer's timing turn an honest crank into a failure.
     */
    function harvest() external {
        if (address(feeShare) == address(0)) revert NoFeeShare();
        uint256 before = quote.balanceOf(address(this));
        feeShare.claim(false);
        emit Harvested(quote.balanceOf(address(this)) - before);
    }
}
