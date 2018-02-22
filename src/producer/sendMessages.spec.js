jest.mock('./groupMessagesPerPartition')
const { newLogger } = require('testHelpers')
const createSendMessages = require('./sendMessages')

const createProducerResponse = (topicName, partition) => ({
  topics: [
    {
      topicName,
      partitions: [
        {
          errorCode: 0,
          offset: `${partition}`,
          partition,
          timestamp: '-1',
        },
      ],
    },
  ],
})

describe('Producer > sendMessages', () => {
  test('only retry failed brokers', async () => {
    const topic = 'topic-name'
    const messages = []
    const partitioner = jest.fn()

    const brokers = {
      1: { nodeId: 1, produce: jest.fn(() => createProducerResponse(topic, 0)) },
      2: { nodeId: 2, produce: jest.fn(() => createProducerResponse(topic, 1)) },
      3: { nodeId: 3, produce: jest.fn(() => createProducerResponse(topic, 2)) },
    }

    const partitionsPerLeader = {
      1: [0],
      2: [1],
      3: [2],
    }

    const cluster = {
      addTargetTopic: jest.fn(),
      findTopicPartitionMetadata: jest.fn(),
      findLeaderForPartitions: jest.fn(() => partitionsPerLeader),
      findBroker: jest.fn(({ nodeId }) => brokers[nodeId]),
    }

    const messagesPerPartition = {
      '0': [{ key: '3' }, { key: '6' }, { key: '9' }],
      '1': [{ key: '1' }, { key: '4' }, { key: '7' }],
      '2': [{ key: '2' }, { key: '5' }, { key: '8' }],
    }

    require('./groupMessagesPerPartition').mockImplementation(() => messagesPerPartition)

    const sendMessages = createSendMessages({ logger: newLogger(), cluster, partitioner })

    brokers[1].produce
      .mockImplementationOnce(() => {
        throw new Error('Some error broker 1')
      })
      .mockImplementationOnce(() => createProducerResponse(topic, 0))

    brokers[3].produce
      .mockImplementationOnce(() => {
        throw new Error('Some error broker 3 one')
      })
      .mockImplementationOnce(() => {
        throw new Error('Some error broker 3 two')
      })
      .mockImplementationOnce(() => createProducerResponse(topic, 2))

    const response = await sendMessages({ topic, messages })
    expect(brokers[1].produce).toHaveBeenCalledTimes(2)
    expect(brokers[2].produce).toHaveBeenCalledTimes(1)
    expect(brokers[3].produce).toHaveBeenCalledTimes(3)
    expect(response).toEqual([
      { errorCode: 0, offset: '0', partition: 0, timestamp: '-1', topicName: 'topic-name' },
      { errorCode: 0, offset: '1', partition: 1, timestamp: '-1', topicName: 'topic-name' },
      { errorCode: 0, offset: '2', partition: 2, timestamp: '-1', topicName: 'topic-name' },
    ])
  })
})
