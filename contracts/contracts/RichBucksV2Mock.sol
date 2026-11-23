// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.24;

import {RichBucks} from "./RichBucks.sol";

/** @dev Upgrade smoke-test implementation — adds a version() getter only. */
contract RichBucksV2Mock is RichBucks {
    function version() external pure returns (string memory) {
        return "v2";
    }
}
