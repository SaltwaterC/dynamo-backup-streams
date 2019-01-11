'use strict';

var util = require('util');
var Readable = require('stream').Readable;

function Backup(options) {
  this.ddb = options.client;
  this.fixedCapacity = parseInt(options.fixedCapacity);
  this.table = options.table;
  this.capacityPercentage = options.capacityPercentage || 25;
  this.retries = options.retries || 10;
  this.delay = options.delay || 1000;
  this.concurrency = options.concurrency || 4;
  this.startSegment = options.startSegment || 0;
  this.totalSegments = options.totalSegments || this.concurrency;

  this.capacityInterval = null;
  this.itemsCount = 0;
  this.itemsProcessed = 0;
  this.units = [];
  this.finished = 0;

  Readable.call(this, options);

  this._readTable();
}
util.inherits(Backup, Readable);

Backup.prototype._read = function() {
  return 0;
};

Backup.prototype._end = function() {
  this.finished++;

  if (this.finished === this.concurrency) {
    this.push(null);
    clearInterval(this.capacityInterval);
    this.emit('close');
  }
};

Backup.prototype._setCapacity = function(units) {
  if(!Number.isNaN(this.fixedCapacity)){
    units = this.fixedCapacity;
  }
  var readPercentage = (units * this.capacityPercentage / 100) | 0;
  this.limit = Math.max(readPercentage, 1);
};

Backup.prototype._readTable = function() {
  var self = this;

  this.ddb.describeTable({
    TableName: this.table
  }, function(err, data) {
    if (err) {
      return self.emit('error', err);
    }

    self.itemsCount = data.Table.ItemCount;
    self._setCapacity(data.Table.ProvisionedThroughput.ReadCapacityUnits);

    var limit = self.limit / self.concurrency | 0;
    limit = Math.max(limit, 1);

    var segment = self.startSegment;
    for (segment; segment < self.startSegment + self.concurrency; segment++) {
      self._streamRecords(null, segment, limit, 0);
    }
  });

  // update the capacity limit every minute if auto scaling kicks in
  this.capacityInterval = setInterval(function() {
    self.ddb.describeTable({
      TableName: self.table
    }, function(err, data) {
      self._setCapacity(data.Table.ProvisionedThroughput.ReadCapacityUnits);
    });
  }, 60000);
};

Backup.prototype._streamRecords = function(startKey, segment, limit, retries) {
  var self = this;
  var startTime = Date.now();

  // don't buffer data in the stream if the stream is paused
  if (this.isPaused()) {
    return setTimeout(function() {
      self._streamRecords(startKey, segment, limit, 0);
    }, 250);
  }

  var options = {
    TableName: this.table,
    Limit: limit,
    ReturnConsumedCapacity: 'TOTAL',
    ConsistentRead: true,
    Segment: segment,
    TotalSegments: this.totalSegments
  };

  if (startKey) {
    options.ExclusiveStartKey = startKey;
  }

  this.ddb.scan(options, function(err, data) {
    var idx;
    var endTime = Date.now();

    if (err) {
      if (retries >= self.retries) {
        clearInterval(self.capacityInterval);
        var error = new Error('Fail: too many retries when reading records');
        error.dynamoError = err;
        return self.emit('error', error);
      }

      return setTimeout(function() {
        retries++;
        self._streamRecords(startKey, segment, limit, retries);
      }, 1000 * retries);
    }

    if (data.Items.length > 0) {
      for (idx in data.Items) {
        self.push(JSON.stringify(data.Items[idx]) + '\n');
        self.itemsProcessed++;
      }
    }

    // dynamically scale read capacity based on record sizes rather than
    // a limit which is pegged against the number of records returned
    var units = data.ConsumedCapacity.CapacityUnits;
    limit = (limit * self.limit / units) / self.concurrency | 0;
    limit = Math.max(limit, 1);
    self.units[segment] = units;

    self.emit('progress', {
      count: self.itemsCount,
      processed: self.itemsProcessed
    });

    if (!data.LastEvaluatedKey) {
      self._end();
    } else {
      setTimeout(function() {
        self._streamRecords(data.LastEvaluatedKey, segment, limit, 0);
      }, self.delay - (endTime - startTime));
    }
  });
};

module.exports = Backup;
