// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/**
 * BermRoot — a durable anchor for a Nostr identity.
 *
 * WHAT THIS MAKES DISPOSABLE
 *   Domains, hosts, relays, image servers, and this project. All of them become
 *   places you can look rather than places you must trust, because the durable
 *   record of *where to look* and *who is current* lives somewhere nobody can
 *   quietly rewrite.
 *
 * WHAT THIS DOES NOT MAKE DISPOSABLE — read this before believing the above.
 *   The tier-1 signer origin. WebAuthn binds a passkey to an RP ID derived from
 *   a DNS name, and the *browser* enforces that, not us. Whoever serves that name
 *   still gets `prf_out` on the next Face ID tap. No contract on any chain
 *   changes what an authenticator will release to whom. Threat T9 is untouched
 *   by this file and is fixed only by giving the user a root the passkey merely
 *   wraps.
 *
 * WHAT IS STORED, AND WHY SO LITTLE
 *   A hash and a few small fields. The chain is an ANCHOR, not a database: the
 *   locator document (relays, blossom servers, node origins) lives off-chain and
 *   only its digest is committed here. That keeps gas small and keeps the record
 *   honest — this contract cannot serve content, so it cannot become the thing
 *   everyone depends on for content.
 *
 * IMMUTABILITY
 *   No owner. No admin. No pause. No upgrade path. No proxy. Nothing in this
 *   file can be called by anyone except the controller of the record being
 *   changed, and `compile.mjs` asserts the compiled ABI and bytecode contain no
 *   privileged surface, no `selfdestruct` and no `delegatecall`.
 *
 *   That is deliberate and it cuts both ways: a bug here cannot be patched. The
 *   contract is therefore as small as it can be, and clients treat it as one
 *   input among several rather than as an oracle (see `src/resolve.ts` — a
 *   client that hard-requires this contract has swapped a DNS dependency for an
 *   RPC one, which is not progress).
 */
contract BermRoot {
    /// @dev Keyed by the 32-byte Nostr public key (x-only, as in NIP-01).
    struct Record {
        /// Address permitted to update this record.
        address controller;
        /// First claim. Never changes, even across handovers — the ordering anchor.
        uint64 claimedAt;
        /// Last write. Lets a reader judge staleness without an indexer.
        uint64 updatedAt;
        /// Monotonic. A reader holding a higher version knows it has a newer copy.
        uint32 version;
        /// One-way. Once true the record is frozen forever.
        bool revoked;
        /// SHA-256 of the off-chain locator document.
        bytes32 pointer;
    }

    struct Handover {
        address pending;
        uint64 readyAt;
    }

    mapping(bytes32 => Record) private _records;
    mapping(bytes32 => Handover) private _handovers;

    /**
     * Delay before a handover can be completed.
     *
     * HONEST ABOUT WHAT THIS BUYS. If your controller key is stolen, the thief
     * can do everything you can — including cancelling your cancellation. The
     * delay does not prevent a takeover. What it does is convert a SILENT
     * takeover into a public one with a warning period: the pending transfer is
     * readable by anyone for a week before it takes effect, so monitors, mirrors
     * and the user's own tooling can shout. Same shape as the signer transparency
     * log — detection, not prevention.
     */
    uint64 public constant HANDOVER_DELAY = 7 days;

    event Claimed(bytes32 indexed pubkey, address indexed controller, bytes32 pointer);
    event Updated(bytes32 indexed pubkey, uint32 version, bytes32 pointer);
    event HandoverStarted(bytes32 indexed pubkey, address indexed to, uint64 readyAt);
    event HandoverCancelled(bytes32 indexed pubkey, address indexed cancelled);
    event HandoverCompleted(bytes32 indexed pubkey, address indexed from, address indexed to);
    event Revoked(bytes32 indexed pubkey);

    error AlreadyClaimed();
    error NotClaimed();
    error NotController();
    error IsRevoked();
    error ZeroPubkey();
    error ZeroPointer();
    error ZeroAddress();
    error NoHandover();
    error TooEarly();
    error NotPendingController();

    modifier live(bytes32 pubkey) {
        Record storage r = _records[pubkey];
        if (r.controller == address(0)) revert NotClaimed();
        if (r.revoked) revert IsRevoked();
        _;
    }

    modifier onlyController(bytes32 pubkey) {
        if (_records[pubkey].controller != msg.sender) revert NotController();
        _;
    }

    /**
     * Claim a pubkey. First writer wins, permanently.
     *
     * There is no arbitration and no admin who can reassign. A squatter who
     * claims a pubkey they do not hold gains nothing: clients require a two-way
     * binding — the Nostr identity must *also* publish an event naming this
     * contract and this controller — so an unmatched claim resolves as
     * `contested` and is worth less than no claim at all.
     */
    function claim(bytes32 pubkey, bytes32 pointer) external {
        if (pubkey == bytes32(0)) revert ZeroPubkey();
        if (pointer == bytes32(0)) revert ZeroPointer();
        if (_records[pubkey].controller != address(0)) revert AlreadyClaimed();

        _records[pubkey] = Record({
            controller: msg.sender,
            claimedAt: uint64(block.timestamp),
            updatedAt: uint64(block.timestamp),
            version: 1,
            revoked: false,
            pointer: pointer
        });

        emit Claimed(pubkey, msg.sender, pointer);
    }

    /// Point at a new locator document. The only routine operation.
    function update(bytes32 pubkey, bytes32 pointer)
        external
        live(pubkey)
        onlyController(pubkey)
    {
        if (pointer == bytes32(0)) revert ZeroPointer();
        Record storage r = _records[pubkey];
        r.pointer = pointer;
        r.updatedAt = uint64(block.timestamp);
        unchecked { r.version += 1; }
        emit Updated(pubkey, r.version, pointer);
    }

    /**
     * Announce a controller change. Takes effect only after HANDOVER_DELAY.
     *
     * Starting a new handover replaces any pending one, so a controller who
     * spots a hostile pending transfer can overwrite it as well as cancel it.
     */
    function startHandover(bytes32 pubkey, address to)
        external
        live(pubkey)
        onlyController(pubkey)
    {
        if (to == address(0)) revert ZeroAddress();
        uint64 readyAt = uint64(block.timestamp) + HANDOVER_DELAY;
        _handovers[pubkey] = Handover({ pending: to, readyAt: readyAt });
        emit HandoverStarted(pubkey, to, readyAt);
    }

    function cancelHandover(bytes32 pubkey)
        external
        live(pubkey)
        onlyController(pubkey)
    {
        Handover memory h = _handovers[pubkey];
        if (h.pending == address(0)) revert NoHandover();
        delete _handovers[pubkey];
        emit HandoverCancelled(pubkey, h.pending);
    }

    /**
     * Completed BY THE INCOMING CONTROLLER, not the outgoing one.
     *
     * A transfer to an address that cannot act is a record nobody can ever
     * update — indistinguishable from a burn. Requiring the recipient to finish
     * the move proves the key exists and is usable before control depends on it.
     */
    function completeHandover(bytes32 pubkey) external live(pubkey) {
        Handover memory h = _handovers[pubkey];
        if (h.pending == address(0)) revert NoHandover();
        if (msg.sender != h.pending) revert NotPendingController();
        if (block.timestamp < h.readyAt) revert TooEarly();

        address from = _records[pubkey].controller;
        _records[pubkey].controller = h.pending;
        _records[pubkey].updatedAt = uint64(block.timestamp);
        delete _handovers[pubkey];

        emit HandoverCompleted(pubkey, from, h.pending);
    }

    /**
     * Mark a key dead. Permanent, and the point of the whole contract.
     *
     * Guardian rotation is social consensus and must never be described as key
     * recovery. THIS is the cryptographic statement that was missing: the
     * controller saying "stop trusting this identity", in a place no host can
     * suppress and no domain expiry can erase. It cannot be undone, because a
     * revocation that can be reversed by whoever stole the key is not one.
     */
    function revoke(bytes32 pubkey) external live(pubkey) onlyController(pubkey) {
        _records[pubkey].revoked = true;
        _records[pubkey].updatedAt = uint64(block.timestamp);
        delete _handovers[pubkey];
        emit Revoked(pubkey);
    }

    /* ---------------------------------------------------------------- */
    /* views                                                            */
    /* ---------------------------------------------------------------- */

    function get(bytes32 pubkey)
        external
        view
        returns (
            address controller,
            uint64 claimedAt,
            uint64 updatedAt,
            uint32 version,
            bool revoked,
            bytes32 pointer
        )
    {
        Record memory r = _records[pubkey];
        return (r.controller, r.claimedAt, r.updatedAt, r.version, r.revoked, r.pointer);
    }

    function pendingHandover(bytes32 pubkey)
        external
        view
        returns (address pending, uint64 readyAt)
    {
        Handover memory h = _handovers[pubkey];
        return (h.pending, h.readyAt);
    }

    function isClaimed(bytes32 pubkey) external view returns (bool) {
        return _records[pubkey].controller != address(0);
    }
}
