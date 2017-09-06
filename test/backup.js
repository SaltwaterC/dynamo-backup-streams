var fs = require('fs');
var zlib = require('zlib');

var Backup = require('./lib/main').Backup;

var table = process.argv[2];

var bs = new Backup({table: table, capacityPercentage: 100});
var gzip = zlib.createGzip({level: 9});
var ws = fs.createWriteStream(table + '.json.gz');

bs.pipe(gzip).pipe(ws);
