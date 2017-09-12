'use strict';

/*global describe: true, before: true, it: true*/

var crypto = require('crypto');
var readline = require('readline');

var AWS = require('aws-sdk');
var assert = require('chai').assert;

var Backup = require('..').Backup;

describe('DynamoDB Backup tests', function() {
  var count = process.env.BACKUP_RECORDS | 0 || 3;
  var records = [],
    ddb = new AWS.DynamoDB();

  before(function(done) {
    var idx, payload, record, putItems = [];

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
      putItems.push({
        PutRequest: {
          Item: record
        }
      });
    }

    var reqItems = {
      RequestItems: {}
    };
    reqItems.RequestItems[process.env.BACKUP_TABLE] = putItems;

    ddb.batchWriteItem(reqItems, function(err) {
      assert.ifError(err, 'DynamoDB fails to write items');
      done();
    });
  });

  describe('backup table', function() {
    it('is expected to backup records from table', function(done) {
      var lineCount = 0;

      var backup = new Backup({
        table: process.env.BACKUP_TABLE,
        concurrency: 1,
        capacityPercentage: 2500
      });

      var lines = readline.createInterface({
        input: backup,
        terminal: false
      });

      lines.on('line', function(line) {
        var idx = JSON.parse(line).primaryKey.N;
        assert.strictEqual(line, JSON.stringify(records[idx]), 'record contents');
        lineCount++;
      });

      lines.on('close', function() {
        assert.strictEqual(lineCount, count, 'number of processed records');
        done();
      });
    });
  });
});
