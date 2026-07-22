// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {ProofOfRest} from "../src/ProofOfRest.sol";

contract DeployProofOfRest is Script {
    function run() external returns (ProofOfRest deployed) {
        vm.startBroadcast();
        deployed = new ProofOfRest();
        vm.stopBroadcast();
    }
}
