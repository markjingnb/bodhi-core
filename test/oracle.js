const web3 = global.web3;
const Oracle = artifacts.require("./Oracle.sol");
const assert = require('chai').assert;
const BlockHeightManager = require('./helpers/block_height_manager');

contract('Oracle', function(accounts) {
    // These should match the decimals in the contract.
    const nativeDecimals = 18;
    const botDecimals = 8;

    const blockHeightManager = new BlockHeightManager(web3);
    const testOracleParams = {
        _eventName: "test",
        _eventResultNames: ["first", "second", "third"],
        _eventBettingEndBlock: 100,
        _decisionEndBlock: 120,
        _averageBlockTime: 10,
        _arbitrationOptionMinutes: 1440
    };
    const baseReward = web3.toBigNumber(10 * Math.pow(10, nativeDecimals));
    const validVotingBlock = testOracleParams._eventBettingEndBlock;
    const participant1 = accounts[1];

    let oracle;

    beforeEach(blockHeightManager.snapshot);
    afterEach(blockHeightManager.revert);

    beforeEach(async function() {
        oracle = await Oracle.new(...Object.values(testOracleParams), { from: accounts[0], value: baseReward });
    });

    describe("New Oracle", async function() {
        it("inits the Oracle with the correct values", async function() {
            assert.equal(web3.toUtf8(await oracle.eventName.call()), testOracleParams._eventName, 
                "eventName does not match");
            assert.equal(web3.toUtf8(await oracle.getEventResultName(0)), testOracleParams._eventResultNames[0], 
                "eventResultName 1 does not match");
            assert.equal(web3.toUtf8(await oracle.getEventResultName(1)), testOracleParams._eventResultNames[1], 
                "eventResultName 2 does not match");
            assert.equal(web3.toUtf8(await oracle.getEventResultName(2)), testOracleParams._eventResultNames[2], 
                "eventResultName 3 does not match");
            assert.equal(await oracle.eventBettingEndBlock.call(), testOracleParams._eventBettingEndBlock, 
                "eventBettingEndBlock does not match");
            assert.equal(await oracle.decisionEndBlock.call(), testOracleParams._decisionEndBlock, 
                "decisionEndBlock does not match");

            let arbitrationBlocks = testOracleParams._arbitrationOptionMinutes / testOracleParams._averageBlockTime;
            let expectedArbitrationOptionEndBlock = testOracleParams._decisionEndBlock + arbitrationBlocks;
            assert.equal(await oracle.arbitrationOptionEndBlock.call(), expectedArbitrationOptionEndBlock, 
                "arbitrationEndBlock does not match");
        });

        it("can handle a long eventName", async function() {
            let params = {
                _eventName: "This is a super long event name that is longer than 32 bytes. It should still work.",
                _eventResultNames: ["first", "second", "third"],
                _eventBettingEndBlock: 100,
                _decisionEndBlock: 120,
                _averageBlockTime: 10,
                _arbitrationOptionMinutes: 1440
            };

            let o = await Oracle.new(...Object.values(params), { from: accounts[0], value: baseReward });
            assert.equal(web3.toUtf8(await o.eventName.call()), params._eventName);
        });

        it("throws if the baseReward is not enough", async function() {
            let invalidMinBaseReward = web3.toBigNumber(10e16);
            assert.isBelow(invalidMinBaseReward.toNumber(), 
                web3.toBigNumber(await oracle.minBaseReward.call()).toNumber(), 
                "Invalid minBaseReward should be below minBaseReward");

            try {
                await Oracle.new(...Object.values(testOracleParams), { from: accounts[1], value: invalidMinBaseReward });
                assert.fail();
            } catch(e) {
                assert.match(e.message, /invalid opcode/);
            }
        });

        it("throws if the eventName is empty", async function() {
            let params = {
                _eventName: "",
                _eventResultNames: ["first", "second", "third"],
                _eventBettingEndBlock: 100,
                _decisionEndBlock: 120,
                _averageBlockTime: 10,
                _arbitrationOptionMinutes: 1440
            };
            assert.equal(0, params._eventName.length, "eventName.length should be 0");

            try {
                await Oracle.new(...Object.values(params), { from: accounts[0], value: baseReward });
                assert.fail();
            } catch(e) {
                assert.match(e.message, /invalid opcode/);
            }
        });

        it("throws if the eventResultNames array is not greater than 1", async function() {
            let params = {
                _eventName: "test",
                _eventResultNames: ["first"],
                _eventBettingEndBlock: 100,
                _decisionEndBlock: 120,
                _averageBlockTime: 10,
                _arbitrationOptionMinutes: 1440
            };

            try {
                await Oracle.new(...Object.values(params), { from: accounts[0], value: baseReward });
                assert.fail();
            } catch(e) {
                assert.match(e.message, /invalid opcode/);
            }
        });

        it("throws if the decisionEndBlock is not greater than eventBettingEndBlock", async function() {
            let params = {
                _eventName: "test",
                _eventResultNames: ["first", "second", "third"],
                _eventBettingEndBlock: 100,
                _decisionEndBlock: 99,
                _averageBlockTime: 10,
                _arbitrationOptionMinutes: 1440
            };

            try {
                await Oracle.new(...Object.values(params), { from: accounts[0], value: baseReward });
                assert.fail();
            } catch(e) {
                assert.match(e.message, /invalid opcode/);
            }
        });

        it("throws if the averageBlockTime is not greater than 0", async function() {
            let params = {
                _eventName: "test",
                _eventResultNames: ["first", "second", "third"],
                _eventBettingEndBlock: 100,
                _decisionEndBlock: 120,
                _averageBlockTime: 0,
                _arbitrationOptionMinutes: 1440
            };

            try {
                await Oracle.new(...Object.values(params), { from: accounts[0], value: baseReward });
                assert.fail();
            } catch(e) {
                assert.match(e.message, /invalid opcode/);
            }
        });

        it("throws if the _arbitrationOptionMinutes is not greater than 0", async function() {
            let params = {
                _eventName: "test",
                _eventResultNames: ["first", "second", "third"],
                _eventBettingEndBlock: 100,
                _decisionEndBlock: 120,
                _averageBlockTime: 10,
                _arbitrationOptionMinutes: 0
            };

            try {
                await Oracle.new(...Object.values(params), { from: accounts[0], value: baseReward });
                assert.fail();
            } catch(e) {
                assert.match(e.message, /invalid opcode/);
            }
        });
    });

    describe("voteResult", async function() {
        it("allows voting", async function() {
            await blockHeightManager.mineTo(validVotingBlock);
            let blockNumber = web3.eth.blockNumber;
            assert(blockNumber >= (await oracle.eventBettingEndBlock.call()).toNumber(), 
                "Block should be at or after eventBettingEndBlock");
            assert.isBelow(blockNumber, (await oracle.decisionEndBlock.call()).toNumber(), 
                "Block should be below decisionEndBlock");

            assert.equal(await oracle.getStakeContributed({ from: participant1 }), 0, 
                "participant1 should have 0 stakeContributed");
            assert.isFalse(await oracle.didSetResult({ from: participant1 }), 
                "participant1 should not have set result");
            assert.equal(await oracle.totalStakeContributed.call(), 0, "totalStakeContributed should be 0");

            let votedResultIndex = 2;
            let stakeContributed = web3.toBigNumber(3 * Math.pow(10, botDecimals));
            await oracle.voteResult(votedResultIndex, { from: participant1, value: stakeContributed });

            let actualStakeContributed = await oracle.getStakeContributed({ from: participant1 });
            assert.equal(actualStakeContributed.toString(), stakeContributed.toString(), 
                "participant1 stakeContributed does not match");
            assert.isTrue(await oracle.didSetResult({ from: participant1 }), "participant1 should have set result");
            assert.equal(await oracle.getVotedResultIndex({ from: participant1 }), votedResultIndex,
                "participant1 voted resultIndex does not match");
        });

        it("throws if the eventResultIndex is invalid", async function() {
            await blockHeightManager.mineTo(validVotingBlock);
            let blockNumber = web3.eth.blockNumber;
            assert(blockNumber >= testOracleParams._eventBettingEndBlock, 
                "Block should be at or after eventBettingEndBlock");
            assert.isBelow(blockNumber, (await oracle.decisionEndBlock.call()).toNumber(), 
                "Block should be below decisionEndBlock");

            try {
                let votedResultIndex = 3;
                let stakeContributed = web3.toBigNumber(3 * Math.pow(10, botDecimals));
                await oracle.voteResult(votedResultIndex, { from: participant1, value: stakeContributed });
                assert.fail();
            } catch(e) {
                assert.match(e.message, /invalid opcode/);
            }
        });

        it("throws if the value is 0", async function() {
            await blockHeightManager.mineTo(validVotingBlock);
            let blockNumber = web3.eth.blockNumber;
            assert(blockNumber >= testOracleParams._eventBettingEndBlock, 
                "Block should be at or after eventBettingEndBlock");
            assert.isBelow(blockNumber, (await oracle.decisionEndBlock.call()).toNumber(), 
                "Block should be below decisionEndBlock");

            try {
                let votedResultIndex = 0;
                await oracle.voteResult(votedResultIndex, { from: participant1 });
                assert.fail();
            } catch(e) {
                assert.match(e.message, /invalid opcode/);
            }
        });

        it("throws if trying to vote before the eventBettingEndBlock", async function() {
            assert.isBelow(web3.eth.blockNumber, (await oracle.eventBettingEndBlock.call()).toNumber(), 
                "Block should be below eventBettingEndBlock");

            try {
                let votedResultIndex = 1;
                let stakeContributed = web3.toBigNumber(3 * Math.pow(10, botDecimals));
                await oracle.voteResult(votedResultIndex, { from: participant1, value: stakeContributed });
                assert.fail();
            } catch(e) {
                assert.match(e.message, /invalid opcode/);
            }
        });

        it("throws if trying to vote after the decisionEndBlock", async function() {
            await blockHeightManager.mineTo(testOracleParams._decisionEndBlock);
            assert(web3.eth.blockNumber >= (await oracle.decisionEndBlock.call()).toNumber(),
                "Block should be greater than or equal to decisionEndBlock");

            try {
                let votedResultIndex = 1;
                let stakeContributed = web3.toBigNumber(3 * Math.pow(10, botDecimals));
                await oracle.voteResult(votedResultIndex, { from: participant1, value: stakeContributed });
                assert.fail();
            } catch(e) {
                assert.match(e.message, /invalid opcode/);
            }
        });

        it("throws if trying to vote again", async function() {
            await blockHeightManager.mineTo(validVotingBlock);
            let blockNumber = web3.eth.blockNumber;
            assert(blockNumber >= (await oracle.eventBettingEndBlock.call()).toNumber(), 
                "Block should be at or after eventBettingEndBlock");
            assert.isBelow(blockNumber, (await oracle.decisionEndBlock.call()).toNumber(), 
                "Block should be below decisionEndBlock");

            assert.isFalse(await oracle.didSetResult({ from: participant1 }), 
                "participant1 should not have set result");

            let votedResultIndex = 2;
            let stakeContributed = web3.toBigNumber(3 * Math.pow(10, botDecimals));
            await oracle.voteResult(votedResultIndex, { from: participant1, value: stakeContributed });

            assert.isTrue(await oracle.didSetResult({ from: participant1 }), "participant1 should have set result");
            assert.equal(await oracle.getVotedResultIndex({ from: participant1 }), votedResultIndex,
                "participant1 voted resultIndex does not match");

            try {
                await oracle.voteResult(votedResultIndex, { from: participant1, value: stakeContributed });
                assert.fail();
            } catch(e) {
                assert.match(e.message, /invalid opcode/);
            }
        });
    });

    describe("getArbitrationOptionBlocks", async function() {
        it("returns the correct number of blocks", async function() {
            var averageBlockTime = 10;
            var arbitrationOptionMinutes = 100;
            assert.equal(await oracle.getArbitrationOptionBlocks(averageBlockTime, arbitrationOptionMinutes), 
                Math.trunc(arbitrationOptionMinutes / averageBlockTime));

            averageBlockTime = 7;
            arbitrationOptionMinutes = 12345;
            assert.equal(await oracle.getArbitrationOptionBlocks(averageBlockTime, arbitrationOptionMinutes), 
                Math.trunc(arbitrationOptionMinutes / averageBlockTime));

            averageBlockTime = 13;
            arbitrationOptionMinutes = 42176;
            assert.equal(await oracle.getArbitrationOptionBlocks(averageBlockTime, arbitrationOptionMinutes), 
                Math.trunc(arbitrationOptionMinutes / averageBlockTime));

            averageBlockTime = 3;
            arbitrationOptionMinutes = 1;
            assert.equal(await oracle.getArbitrationOptionBlocks(averageBlockTime, arbitrationOptionMinutes), 
                Math.trunc(arbitrationOptionMinutes / averageBlockTime));

            averageBlockTime = 5;
            arbitrationOptionMinutes = 0;
            assert.equal(await oracle.getArbitrationOptionBlocks(averageBlockTime, arbitrationOptionMinutes), 
                Math.trunc(arbitrationOptionMinutes / averageBlockTime));
        });

        it("throws if averageBlockTime is 0", async function() {
            try {
                await oracle.getArbitrationOptionBlocks(0, 100);
                assert.fail();
            } catch(e) {
                assert.match(e.message, /invalid opcode/);
            }
        });
    });
});
