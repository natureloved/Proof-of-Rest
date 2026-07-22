// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title Touched Grass — Soulbound streak badges
/// @notice Non-transferable (soulbound) ERC-721 badges awarded by ProofOfRest
///         as a builder's streak of respected sessions crosses 1, 3, and 7.
contract RestBadge is ERC721, Ownable {
    // Badge type thresholds: 1 = First Grass Touched, 3 = 3x Streak, 7 = Break Champion
    uint32 public constant THRESHOLD_1 = 1;
    uint32 public constant THRESHOLD_3 = 3;
    uint32 public constant THRESHOLD_7 = 7;

    address public authorizedMinter; // ProofOfRest contract

    // user => threshold => minted (so each badge mints exactly once)
    mapping(address => mapping(uint32 => bool)) public claimed;
    mapping(uint32 => string) public badgeName; // threshold => name

    error SoulboundNonTransferable();
    error NotAuthorizedMinter();
    error AlreadyClaimed();

    event BadgeMinted(address indexed user, uint32 indexed threshold, uint256 tokenId, string name);

    constructor() ERC721("Touched Grass", "TGRASS") Ownable(msg.sender) {
        badgeName[THRESHOLD_1] = "First Grass Touched";
        badgeName[THRESHOLD_3] = "3x Streak";
        badgeName[THRESHOLD_7] = "7x Streak - Break Champion";
    }

    /// @notice Called only by ProofOfRest when a user's streak crosses a threshold.
    function mintIfEligible(address user, uint32 userStreak) external {
        if (msg.sender != authorizedMinter) revert NotAuthorizedMinter();

        uint32[] memory thresholds = new uint32[](3);
        thresholds[0] = THRESHOLD_1;
        thresholds[1] = THRESHOLD_3;
        thresholds[2] = THRESHOLD_7;

        for (uint256 i = 0; i < thresholds.length; i++) {
            uint32 t = thresholds[i];
            if (userStreak >= t && !claimed[user][t]) {
                claimed[user][t] = true;
                uint256 tokenId = _encodeTokenId(user, t);
                _mint(user, tokenId);
                emit BadgeMinted(user, t, tokenId, badgeName[t]);
            }
        }
    }

    /// @dev tokenId encodes owner + threshold so badges are distinguishable
    ///      while staying unique per (user, threshold).
    function _encodeTokenId(address user, uint32 threshold) internal pure returns (uint256) {
        return (uint256(uint160(user)) << 32) | uint256(threshold);
    }

    /// @notice Decode a tokenId back to its owner + threshold (helper for the UI).
    function decodeTokenId(uint256 tokenId) external pure returns (address owner, uint32 threshold) {
        owner = address(uint160(tokenId >> 32));
        threshold = uint32(tokenId & 0xffffffff);
    }

    function setAuthorizedMinter(address _minter) external onlyOwner {
        authorizedMinter = _minter;
    }

    /// @dev Soulbound: any transfer between two non-zero addresses reverts.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            revert SoulboundNonTransferable();
        }
        return super._update(to, tokenId, auth);
    }

    /// @dev Onchain SVG metadata — simple but self-contained (no external host needed).
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        uint32 threshold = uint32(tokenId & 0xffffffff);
        string memory name = badgeName[threshold];
        string memory desc = string(
            abi.encodePacked("Awarded for a streak of ", _uint2str(threshold), " respected rest sessions on Proof of Rest.")
        );

        string memory json = string(
            abi.encodePacked(
                '{"name":"',
                name,
                '","description":"',
                desc,
                '","image":"data:image/svg+xml;utf8,',
                _badgeSvg(name, threshold),
                '"}'
            )
        );
        return string(abi.encodePacked("data:application/json;utf8,", json));
    }

    function _badgeSvg(string memory name, uint32 threshold) internal pure returns (string memory) {
        return string(
            abi.encodePacked(
                "<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'>",
                "<rect width='100%' height='100%' fill='#0b160f'/>",
                "<circle cx='120' cy='100' r='46' fill='none' stroke='#7CFC9B' stroke-width='6'/>",
                "<text x='120' y='108' font-size='40' fill='#7CFC9B' text-anchor='middle' font-family='monospace'>",
                _uint2str(threshold),
                "</text>",
                "<text x='120' y='180' font-size='16' fill='#e6f5ec' text-anchor='middle' font-family='monospace'>",
                name,
                "</text></svg>"
            )
        );
    }

    function _uint2str(uint32 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint32 j = v;
        uint256 len;
        while (j != 0) {
            len++;
            j /= 10;
        }
        bytes memory b = new bytes(len);
        uint256 k = len;
        while (v != 0) {
            k--;
            b[k] = bytes1(uint8(48 + (v % 10)));
            v /= 10;
        }
        return string(b);
    }
}
