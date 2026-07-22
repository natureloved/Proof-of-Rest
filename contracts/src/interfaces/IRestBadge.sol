// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRestBadge {
    function mintIfEligible(address user, uint32 streak) external;
}
