'use strict';

var fs = require('fs');
var zlib = require('zlib');

var Backup = require('../lib/main').Backup;

var table = process.argv[2];

var bs = new Backup({
  table: table,
  capacityPercentage: 100,
  delay: 900
});
var gzip = zlib.createGzip({
  level: 9
});
var ws = fs.createWriteStream(table + '.json.gz');

bs.pipe(gzip).pipe(ws);

// outputs a lot less noise compared to listening for 'progress' events
var progress = setInterval(function() {
  var percent = 0;
  if (bs.itemsCount > 0 && bs.itemsProcessed > 0) {
    percent = bs.itemsProcessed / bs.itemsCount * 100;
    if (percent > 100) {
      percent = 100;
    }

    if (percent === 100) {
      clearInterval(progress);
    }
  }

  console.log(table + ' progress: %f% - %d of %d; capacity %d - used %d', percent, bs.itemsProcessed, bs.itemsCount, bs.limit, bs.units);
}, 1000);

bs.on('end', function() {
  clearInterval(progress);
});
