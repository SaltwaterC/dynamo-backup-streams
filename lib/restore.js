'use strict';

var util = require('util');
var readline = require('readline');
var PassThrough = require('stream').PassThrough;

var AWS = require('aws-sdk');

function Restore(options) {
  this.table = options.table;
  this.capacityPercentage = options.capacityPercentage || 25;
  this.retries = options.retries || 10;
  this.delay = options.delay || 1000;
  this.bufferSize = options.bufferSize || 250;

  this.capacityInterval = null;
  this.lines = 0;
  this.processedLines = 0;
  this.lineBuffer = [];
  this.units = 0;
  this.closed = false;
  this.dynamoStream = false;

  this.ddb = new AWS.DynamoDB();
  PassThrough.call(this, options);

  this._readLines();
}
util.inherits(Restore, PassThrough);

Restore.prototype._readLines = function() {
  var self = this;

  this.readline = readline.createInterface({
    input: this,
    terminal: false
  });

  this.readline.on('line', function(line) {
    self.lines++;
    self.lineBuffer.push({
      PutRequest: {
        Item: JSON.parse(line)
      }
    });

    if (self.lineBuffer.length > self.bufferSize) {
      self.readline.pause();

      if (!self.dynamoStream) {
        self.dynamoStream = true;
        self._writeTable();
      }
    }
  });

  this.readline.on('close', function() {
    self.closed = true;
    clearInterval(self.capacityInterval);
  });
};

Restore.prototype._setCapacity = function(units) {
  var writePercentage = (units * this.capacityPercentage / 100) | 0;
  this.limit = Math.max(writePercentage, 1);
};

Restore.prototype._writeTable = function() {
  var self = this;

  this.ddb.describeTable({
    TableName: this.table
  }, function(err, data) {
    if (err) {
      return self.emit('error', err);
    }

    self._setCapacity(data.Table.ProvisionedThroughput.WriteCapacityUnits);
    self._streamRecords(self.limit, 0, null);
  });

  // update the capacity limit every minute if auto scaling kicks in
  this.capacityInterval = setInterval(function() {
    self.ddb.describeTable({
      TableName: self.table
    }, function(err, data) {
      self._setCapacity(data.Table.ProvisionedThroughput.WriteCapacityUnits);
    });
  }, 60000);
};

Restore.prototype._streamRecords = function(limit, retries, reqItems) {
  var self = this;
  var startTime = Date.now();

  if (this.lineBuffer.length < this.bufferSize) {
    this.readline.resume();
  }

  limit = Math.min(limit, 25);
  var records = this.lineBuffer.splice(0, limit);

  if (!reqItems) {
    reqItems = {
      ReturnConsumedCapacity: 'TOTAL',
      RequestItems: {}
    };
    reqItems.RequestItems[this.table] = records;
  }

  this.ddb.batchWriteItem(reqItems, function(err, data) {
    var endTime = Date.now();

    if (err) {
      retries++;
      return setTimeout(function() {
        self._streamRecords(limit, retries, reqItems);
      }, 1000 * retries);
    }

    // dynamically scale write capacity
    self.units = data.ConsumedCapacity[0].CapacityUnits;
    limit = limit * self.limit / self.units | 0;
    limit = Math.max(limit, 1);

    if (data.UnprocessedItems && data.UnprocessedItems[self.table]) {
      self.processedLines += reqItems.RequestItems[self.table].length - data.UnprocessedItems[self.table].length;

      reqItems = {
        ReturnConsumedCapacity: 'TOTAL',
        RequestItems: {}
      };
      reqItems.RequestItems = data.UnprocessedItems;

      setTimeout(function() {
        self._streamRecords(limit, 0, null);
      }, self.delay - (endTime - startTime));
    } else {
      self.processedLines += reqItems.RequestItems[self.table].length;

      if (self.lineBuffer.length > 0) {
        setTimeout(function() {
          self._streamRecords(limit, 0, null);
        }, self.delay - (endTime - startTime));
      } else {
        if (!self.closed) {
          // wait for the read buffer to fill
          self.readline.resume();
          setTimeout(function() {
            self._streamRecords(limit, 0, null);
          }, 1000);
        }
      }
    }
  });
};

module.exports = Restore;
