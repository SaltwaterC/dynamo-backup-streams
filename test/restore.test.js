'use strict';

var crypto = require('crypto');
var Readable = require('stream').Readable;

var AWS = require('aws-sdk');
var assert = require('chai').assert;

var Restore = require('..').Restore;

describe('DynamoDB Restore tests', function() {
  var count = process.env.RESTORE_RECORDS | 0 || 3;
  var records = [],
    ddb = new AWS.DynamoDB();

  before(function(done) {
    var idx, payload, record;

    var stream = new Readable();
    var restore = new Restore({
      client: ddb,
      table: process.env.RESTORE_TABLE,
      capacityPercentage: 2500
    });

    for (idx = 0; idx < count; idx++) {
      payload = Date.now().toString() + idx;

      record = {
        payload: {
          S: crypto.createHash('sha256').update(payload).digest('hex')
        },
        primaryKey: {
          N: idx.toString()
        }
      };
      records.push(record);
      stream.push(JSON.stringify(record) + '\n');
    }
    stream.push(null);
    stream.pipe(restore);

    restore.on('error', function(err) {
      assert.ifError(err, 'Restore fails to write');
    });

    restore.on('close', function() {
      done();
    });
  });

  describe('restore table', function() {
    it('is expectedo to verify successfully the restore', function(done) {
      ddb.scan({
        TableName: process.env.RESTORE_TABLE,
        ConsistentRead: true
      }, function(err, data) {
        var idx, recIdx;

        assert.ifError(err, 'DynamoDB fails to scan');

        assert.strictEqual(data.Count, count, 'number of restored records');

        for (idx in data.Items) {
          recIdx = data.Items[idx].primaryKey.N;
          assert.strictEqual(JSON.stringify(data.Items[idx]), JSON.stringify(records[recIdx]), 'record contents');
        }

        done();
      });
    });
  });
});
