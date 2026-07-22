// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {RestBadge} from "../src/RestBadge.sol";

contract DeployRestBadge is Script {
    function run() external returns (RestBadge deployed) {
        vm.startBroadcast();
        deployed = new RestBadge();
        vm.stopBroadcast();
    }
}
