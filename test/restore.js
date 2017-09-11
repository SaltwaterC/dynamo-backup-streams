'use strict';

var fs = require('fs');
var zlib = require('zlib');

var Restore = require('../lib/main').Restore;

var table = process.argv[2];

var rs = fs.createReadStream(table + '.json.gz');
var gunzip = zlib.createGunzip();
var rss = new Restore({
  table: table,
  capacityPercentage: 100
});

rs.pipe(gunzip).pipe(rss);

process.on('exit', function() {
  console.log();
  console.log('total lines: %d', rss.lines);
  console.log('processed lines: %d', rss.processedLines);
});
