const AddressManager = artifacts.require("./storage/AddressManager.sol");
const EventFactory = artifacts.require("./events/EventFactory.sol");
const TopicEvent = artifacts.require("./events/TopicEvent.sol");
const OracleFactory = artifacts.require("./oracles/OracleFactory.sol");
const CentralizedOracle = artifacts.require("./oracles/CentralizedOracle.sol");
const BlockHeightManager = require('../helpers/block_height_manager');
const assertInvalidOpcode = require('../helpers/assert_invalid_opcode');
const Utils = require('../helpers/utils');
const web3 = global.web3;
const assert = require('chai').assert;

contract('EventFactory', function(accounts) {
    const blockHeightManager = new BlockHeightManager(web3);
    const testTopicParams = {
        _oracle: accounts[1],
        _name: ['Will Apple stock reach $300 by t', 'he end of 2017?'],
        _resultNames: ['first', 'second', 'third'],
        _bettingEndBlock: 100,
        _resultSettingEndBlock: 110
    };

    let addressManager;
    let eventFactory;
    let eventFactoryCreator = accounts[0];
    let oracleFactory;
    let topic;
    let topicCreator = accounts[1];

    beforeEach(blockHeightManager.snapshot);
    afterEach(blockHeightManager.revert);

    beforeEach(async function() {
        addressManager = await AddressManager.deployed({ from: eventFactoryCreator });
        
        eventFactory = await EventFactory.deployed(addressManager.address, { from: eventFactoryCreator });
        await addressManager.setEventFactoryAddress(eventFactory.address, { from: eventFactoryCreator });
        assert.equal(await addressManager.getEventFactoryAddress(0), eventFactory.address);

        oracleFactory = await OracleFactory.deployed(addressManager.address, { from: eventFactoryCreator });
        await addressManager.setOracleFactoryAddress(oracleFactory.address, { from: eventFactoryCreator });
        assert.equal(await addressManager.getOracleFactoryAddress(0), oracleFactory.address);
        
        let transaction = await eventFactory.createTopic(...Object.values(testTopicParams), { from: topicCreator });
        topic = await TopicEvent.at(transaction.logs[0].args._topicAddress);
    });

    describe('constructor', async function() {
        it('should store the EventFactory address in AddressManager', async function() {
            let index = await addressManager.getLastEventFactoryIndex();
            assert.equal(await addressManager.getEventFactoryAddress(index), eventFactory.address);
        });

        it('throws if the AddressManager address is invalid', async function() {
            try {
                await EventFactory.new(0, { from: eventFactoryCreator });
                assert.fail();
            } catch(e) {
                assertInvalidOpcode(e);
            }
        });
    });

    describe('TopicEvent:', async function() {
        it('initializes all the values of the new topic correctly', async function() {
            assert.equal(await topic.owner.call(), topicCreator);
            assert.equal(web3.toUtf8(await topic.name.call(0)), testTopicParams._name[0]);
            assert.equal(web3.toUtf8(await topic.name.call(1)), testTopicParams._name[1]);
            assert.equal(web3.toUtf8(await topic.resultNames.call(0)), testTopicParams._resultNames[0]);
            assert.equal(web3.toUtf8(await topic.resultNames.call(1)), testTopicParams._resultNames[1]);
            assert.equal(web3.toUtf8(await topic.resultNames.call(2)), testTopicParams._resultNames[2]);
            assert.equal((await topic.numOfResults.call()).toNumber(), 3);

            let centralizedOracle = await CentralizedOracle.at((await topic.oracles.call(0))[0]);
            assert.equal(await centralizedOracle.oracle.call(), testTopicParams._oracle);
            assert.equal(await centralizedOracle.getEventName(), testTopicParams._name.join(''));
            assert.equal(await centralizedOracle.getEventResultName(0), testTopicParams._resultNames[0]);
            assert.equal(await centralizedOracle.getEventResultName(1), testTopicParams._resultNames[1]);
            assert.equal(await centralizedOracle.getEventResultName(2), testTopicParams._resultNames[2]);
            assert.equal(await centralizedOracle.numOfResults.call(), 3);
            assert.equal(await centralizedOracle.bettingEndBlock.call(), testTopicParams._bettingEndBlock);
            assert.equal(await centralizedOracle.resultSettingEndBlock.call(), testTopicParams._resultSettingEndBlock);
            assert.equal((await centralizedOracle.consensusThreshold.call()).toString(), 
                (await addressManager.startingOracleThreshold.call()).toString());
        });

        it('does not allow recreating the same topic twice', async function() {
            assert.isTrue(await eventFactory.doesTopicExist(testTopicParams._name, testTopicParams._resultNames,
                testTopicParams._bettingEndBlock, testTopicParams._resultSettingEndBlock));
            try {
                await eventFactory.createTopic(...Object.values(testTopicParams), { from: topicCreator });
            } catch(e) {
                assertInvalidOpcode(e);
            }
        });
    });
});
