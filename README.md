## About [![build status](https://secure.travis-ci.org/SaltwaterC/dynamo-backup-streams.png?branch=master)](https://travis-ci.org/SaltwaterC/dynamo-backup-streams) [![NPM version](https://badge.fury.io/js/dynamo-backup-streams.png)](http://badge.fury.io/js/dynamo-backup-streams)

Backup / Restore DynamoDB node.js streams. Designed to be used in various pipelines in order to build custom backup / restore solutions. Both Backup and Restore handle properly few things, like back-pressure and capacity usage (including auto-scaling).

## System requirements

 * node.js 6+

`aws-sdk` must be installed before using this library. A DynamoDB client instance must be passed to the Backup / Restore constructor.

## Backup

Implemented as node.js Readable stream. Built on top of DynamoDB Scan with ConsistentRead. It outputs a stream of JSON encoded DynamoDB items separated by newline.

The backup.js example shows how a pipeline with Backup works. In this particular case, the Backup stream is piped into gzip, then piped into a file.

```javascript
var AWS = require('aws-sdk');
var Backup = require('dynamo-backup-streams').Backup;
var backupStream = new Backup({
  client: new AWS.DynamoDB(),
  table: 'table_name'
});

// get an output stream somehow
backupStream.pipe(outputStream); // do stuff with the stream
```

The Backup constructor accepts an options object. The spec for that object:

 * `client` - DynamoDB client instance created with `new AWS.DynamoDB()`
 * `table` - indicates the DynamoDB table name to backup. This is the only compulsory option.
 * `capacityPercentage` - the percentage of the read capacity units to use on DynamoDB to be used as the total target capacity. Default: 25.
 * `retries` - the number of retries for each read request. Default: 10.
 * `delay` - the target delay in milliseconds between each request. Default: 1000.
 * `concurrency` - the number of workers to use for reading the data. Each worker reads a Scan segment. Default: 4.
 * `fixedCapacity` - Number to operate on a fixed capacity e.g. needed to utilize tables in [on demand mode](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadWriteCapacityMode.html#HowItWorks.OnDemand
).
 Make sure to consult the [available throughput in your region](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Limits.html#default-limits-throughput). Default undefined

The actual capacity requirements are calculated on each request. One read unit equals to 4KB/s of throughput. DynamoDB Scan counts the total size of the items for the purpose of capacity usage which makes this operation very efficient. On each request, the used capacity is compared against the target capacity of the worker. The target capacity is then adjusted accordingly. The total target capacity is checked against DynamoDB every 60 seconds to see if auto-scaling has kicked in. The target capacity of the worker is calculated by dividing the total target capacity to the number of workers and rounding down to the nearest integer unit. The read capacity per worker can't be smaller than 1.

If the size of a typical item is greater than the maximum request size which can be as low as 1 read unit per worker, then the capacity usage would be higher than the specified percentage. You may need to reduce the number of workers to fit into the capacity target.

The maximum throughput which can be achieved per worker is 257 read units (1028 KB/s). This is the throughput limit of DynamoDB partitions. Basically, a worker is needed for every 257 read units in order to fully utilise the read capacity, if desired.

The delay option should not be adjusted, unless there's a reason to do so. Bear in mind that the delay value is a target, not the actual delay between the current and the next request. The capacity is computed dynamically, however, since it's in KB/s, a request needs to be executed, on average, every second. With network latency which can't be predicted and auto-scaling, a fixed offset won't work for achieving this 1 request/second target. Every request is measured to see how much time it takes to process. This time difference is then subtracted from the delay target, then the next request is scheduled based on this dynamic offset.

If the stream is paused, no data is being read from DynamoDB. The status of the paused state is checked every 250 milliseconds. The stream would emit data events for requests still in flight. The stream would be fully paused once all the DynamoDB Scan requests have been completed.

## Restore

Implemented as node.js PassThrough stream. Built on top of DynamoDB BatchWriteItem. The input is a stream created by Backup. For all intents and purposes this object must be used as a Writable stream. The Readable bit is passed internally to [readline](https://nodejs.org/api/readline.html) to tokenise the input stream into lines which then are parsed as JSON. readline is handling the back-pressure whenever the line buffer is filled.

The restore.js example shows how a pipeline with Restore works. In this particular case, a file read stream is piped into gunzip, then piped into the Restore stream.

```javascript
var AWS = require('aws-sdk');
var Restore = require('dynamo-backup-streams').Restore;
var restoreStream = new Restore({
  client: new AWS.DynamoDB(),
  table: 'table_name'
});

// get an input stream somehow
inputStream.pipe(restoreStream);
```

The Restore constructor accepts an options object. The spec for that object:

 * `client` - DynamoDB client instance created with `new AWS.DynamoDB()`
 * `table` - indicates the DynamoDB table name to backup. This is the only compulsory option.
 * `capacityPercentage` - the percentage of write capacity units to use on DynamoDB to be used as the total target capacity. Default: 25.
 * `retries` - the number of retries for each write request. Default: 10.
 * `delay` - the target delay in milliseconds between each request. Default: 1000.
 * `concurrency` - the number of workers to use for writing the data. Default: 1.
 * `bufferSize` - the size of the line buffer created by reading from readline. Default: 250 * `concurrency`.
 * `maxItems` - the maximum number of items in a batchWriteItem request. Default: 25. Max: 25.

The same formulas for capacity sizing and request timings used for the Backup stream apply. There are certain differences though. One write unit equals to 1KB/s of throughput. DynamoDB BatchWriteItem counts the size of each individual item and the value is rounded up to the nearest KB. This makes the capacity sizing tad inefficient compared to Scan. The general limits for BatchWriteItem apply: up to 25 items per batch, 400KB as the maximum size of the item, and 16MB as the total size of the BatchWriteItem request.

If the lines buffer is full, readline is paused until the buffer size drops under the set limit. Because readline doesn't pause the stream immediately, i.e the in flight input Buffers may still trigger line events, the actual size of the line buffer may be higher, but not by much. By default, the capacity of this buffer is set dynamically. Each worker adds 250 units to the line buffer limit. Since the main limitation is the slow throughput of DynamoDB writes, this buffer would be pretty much full for the whole duration of the restore process.

This stream emits the close event when the line buffer is drained and the readline stream is closed. This indicates that no more writes are being done to DynamoDB.

## AWS Authentication

By default, if no authentication options are being specified, aws-sdk tries to use the environment variables or the instance profile credentials (if running on EC2).

The minimum environment variables required to make it work:

 * `AWS_REGION`
 * `AWS_ACCESS_KEY_ID`
 * `AWS_SECRET_ACCESS_KEY`

To use a credentials profile saved as ini files with environment variables:

 * `AWS_REGION`
 * `AWS_PROFILE`

To specify in code a credentials profile:

```javascript
new AWS.DynamoDB({
  credentials: new AWS.SharedIniFileCredentials({
    profile: 'profile_name'
  })
});
```

## Screenshots

These screenshots display the capacity usage for a large table backup with auto-scaling turned on.

![large-table-1h.png](/screenshots/large-table-1h.png?raw=true "large-table-1h.png")

![large-table-3h.png](/screenshots/large-table-3h.png?raw=true "large-table-3h.png")
