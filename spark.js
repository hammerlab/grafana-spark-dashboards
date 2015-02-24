/* global _ */

'use strict';

// accessible variables in this scope
var window, document, ARGS, $, jQuery, moment, kbn;

// All url parameters are available via the ARGS object
var ARGS;

function getBoolParam(b, def) {
  if (_.isUndefined(b)) return def;
  return b=='1' || b=='true' || b=='on' || b.toLowerCase()=='yes';
}

function getIntParam(i, def) {
  if (_.isUndefined(i)) return def;
  return parseInt(i);
}

var maxExecutorId = getIntParam(ARGS.maxExecutorId, 20);

var now = false;
var collapseExecutors = getBoolParam(ARGS.collapseExecutors, true);
var sharedTooltip = getBoolParam(ARGS.sharedTooltip, true);
var legends = getBoolParam(ARGS.legends, false);
var executorLegends = getBoolParam(ARGS.executorLegends, true);
var percentilesAndTotals = getBoolParam(ARGS.percentiles, false);


function fetchYarnApps() {
  var apps = null;
  // TODO(ryan): inject / configure this value somehow.
  jQuery.ajax('http://demeter-login2.demeter.hpc.mssm.edu:8091/ws/v1/cluster/apps', {
    accepts: { json: 'application/json' },
    dataType: 'json',
    async: false,
    success: function(data) {
      apps = data.apps;
    },
    error: function(xhr, status, err) {
      console.error(xhr, status, err);
      throw new Error(err);
    }
  });
  return apps;
}

function findYarnApp(appId) {
  var apps = fetchYarnApps();
  var foundApp = null;
  apps.app.forEach(function(app) {
    if (app.id.indexOf(appId) >= 0) {
      console.log("Found app %s: %O", app.id, app);

      var now = app.finalStatus == "UNDEFINED" || app.finishedTime == "0";
      if ((app.finalStatus == "UNDEFINED") != (app.finishedTime == "0")) {
        throw new Error("Invalid app status: ", app.id, app.finalStatus, app.finishedTime);
      }

      foundApp = {
        prefix: app.id,
        now: now,
        from: new Date(app.startedTime).toString(),
        to: now ? "now" : new Date(app.finishedTime).toString()
      }
    }
  });
  if (foundApp == null) {
    throw new Error("No application found for ID: %s", appId);
  }
  return foundApp;
}

function getFrom() {
  if (_.isUndefined(ARGS.from)) {
    return 'now-1h';
  }
  if (ARGS.from.match(/^now-[0-9]+/)) {
    return ARGS.from;
  }
  return new Date(ARGS.from).toString();
}

function getTo() {
  if (_.isUndefined(ARGS.to)) {
    return 'now';
  }
  if (ARGS.to.match(/^now-[0-9]+/)) {
    return ARGS.to;
  }
  return new Date(ARGS.to).toString();
}

function getYarnAppInfo() {
  if (_.isUndefined(ARGS.app) && _.isUndefined(ARGS.prefix)) {
    throw new Error("'app' xor 'name' URL parameter required");
  }
  if (!_.isUndefined(ARGS.app)) {
    var app = findYarnApp(ARGS.app);
    if (!_.isUndefined(ARGS.prefix)) {
      app.prefix = ARGS.prefix;
    }
    return app;
  }
  if (!_.isUndefined(ARGS.prefix)) {
    var from = getFrom();
    var to = getTo();
    var now = (to == 'now');
    return {
      prefix: ARGS.prefix,
      now: now,
      from: from,
      to: to,
    };
  } else {
    return ;
  }
}

var app = getYarnAppInfo();

// Return the maximal common prefix of two strings.
function getSharedPrefix(minStr, maxStr) {
  if (minStr.length < maxStr.length) return "";
  var i = 0;
  for (; i < minStr.length && minStr[i] == maxStr[i]; i++) {}
  return minStr.substr(0, i);
}

// Return @num copies of @str.
function copies(str, num) {
  var ret = '';
  for (var i = 0; i < num; i++) { ret += str; }
  return ret;
}

/**
 * Compute a Graphite-digestible "regex" range covering the closed
 * interval [min,max].
 *
 * Examples:
 *
 *    [1,10]:     {1-9,10}
 *    [1,100]:    {1-9,[1-9][0-9],100}
 *    [123,1234]: {12[3-9],1[3-9][0-9],[2-9][0-9][0-9],1[0-1][0-9][0-9],12[0-2][0-9],123[0-4]}
 */
function getGraphiteRanges(min, max) {
  var curPow10 = 1;
  var nextPow10 = 10;
  var ranges = [];

  function maybeAddRange(origMin, nextMin) {
    if (origMin <= nextMin-1) {
      var minStr = (nextMin-1).toString();
      var origMinStr = origMin.toString();
      var prefix = getSharedPrefix(minStr, origMinStr);
      var mid = (origMin == nextMin-1) ? '' : ('[' + origMinStr[prefix.length] + '-' + minStr[prefix.length] + ']');
      var range = prefix + mid + copies('[0-9]', minStr.length - (prefix.length + 1));
      ranges.push(range);
    }
  }

  while (min <= max) {
    var origMin = min;
    var nextMin;
    while (true) {
      nextMin = min + curPow10;
      if (nextMin-1 > max || nextMin % nextPow10 == 0) break;
      min = nextMin;
    }
    if (nextMin-1 <= max) {
      maybeAddRange(origMin, nextMin);
      curPow10 = nextPow10;
      nextPow10 *= 10;
      min = nextMin;
    } else {
      maybeAddRange(origMin, min);
      nextPow10 = curPow10;
      curPow10 /= 10;
    }
  }
  return ranges;
}

function getGraphiteRangesStr(min, max) { return '{' + getGraphiteRanges(min, max).join(',') + '}'; }

// Parse a comma-delimited list of dash-delimited integer-pairs from
// a query param value.
function getIntRangeParams(param) {
  var ranges = [];
  if (param) {
    param.split(',').forEach(function (rangeStr) {
      var match = rangeStr.match(/([0-9]+)-([0-9]+)/);
      if (match) {
        var from = parseInt(match[1]);
        var to = parseInt(match[2]);
        ranges.push({ from: from, to: to, graphite: getGraphiteRanges(from, to) });
      }
    });
  }
  return ranges;
}


// "Template" variables: dynamically configurable on the page's title-bar.
var prefixTemplateVar = {
  type: "query",
  name: "prefix",
  options: [
    {
      text: app.prefix,
      value: app.prefix
    }
  ],
  query: "*",
  allFormat: "glob",
  includeAll: true,
  datasource: "graphite",
  refresh_on_load: true,
  refresh: true,
  current: {
    text: app.prefix,
    value: app.prefix
  }
};

var driverTemplateVar = {
  type: "custom",
  name: "driver",
  query: "",
  options: [
    // This is the value Spark typically sends to Graphite.
    { text: "<driver>", value: "<driver>" },
    // If Spark sends its metrics to Graphite via StatsD, the driver identifier loses its angle-
    // brackets for some reason.
    { text: "driver", value: "driver" },
  ],
  current: { text: "<driver>", value: "<driver>" }
};

var executorRangeTemplateVar = {
  type: "custom",
  name: "executorRange",
  query: "",
  options: [
    {
      text: "*",
      value: "*"
    }
  ],
  includeAll: true,
  allFormat: "glob",
  current: {
    text: "*",
    value: "*"
  }
};

/**
 * Initialize options for the "$executorRange" template variable,
 * including:
 *
 *   - options covering [1,@maxExecutorId] in chunks of 1, 10, 100,
 *     etc., for all powers of 10 such that [1,@maxExecutorId] is
 *     covered with <= 100 options
 *   - an "all" ("*") option
 *   - if the "executors" query param was passed:
 *     - one option that is the union of all ranges found in the
 *       "executors" query param
 *     - one option per range in the "executors" query param
 */
var executorRanges = getIntRangeParams(ARGS.executors);
if (executorRanges.length) {

  // Add an option that is the union of all ranges passed in the
  // "executors" query param; make it the "current" option as well.
  var allRangesGraphiteValue =
        '{' +
        executorRanges.map(function(range) {
          return range.graphite.join(',');
        }).join(',') +
        '}';
  var allRangesGraphiteOption = { text: ARGS.executors, value: allRangesGraphiteValue };
  executorRangeTemplateVar.options.push(allRangesGraphiteOption);
  executorRangeTemplateVar.current = allRangesGraphiteOption;

  // If there are more "executors"-query-param ranges, add separate
  // options for each one as well.
  if (executorRanges.length > 1) {
    executorRanges.forEach(function (executorRange) {
      executorRangeTemplateVar.options.push(
            {
              text: executorRange.from + '-' + executorRange.to,
              value: '{' + executorRange.graphite.join(',') + '}'
            }
      );
    });
  }
}

// Add options that cover [1,@maxExecutorId] with intervals sized
// to powers of 10; abort when the number of intervals required for
// a given power of 10 exceeds 100.
var executorRangeWidth = 1;
while (10*executorRangeWidth < maxExecutorId) { executorRangeWidth *= 10; }
while (executorRangeWidth > 0) {
  var numRanges = Math.ceil(maxExecutorId / executorRangeWidth);
  if (numRanges > 100) break;
  for (var range = 0; range < numRanges; range++) {
    var executorIdRangeMin = range * executorRangeWidth + 1;
    var executorIdRangeMax = Math.min((range+1) * executorRangeWidth, maxExecutorId);
    var text = (executorIdRangeMin == executorIdRangeMax) ?
          (executorIdRangeMin + '') :
          (executorIdRangeMin + "-" + executorIdRangeMax);
    var value = getGraphiteRangesStr(executorIdRangeMin, executorIdRangeMax);
    executorRangeTemplateVar.options.push({ text: text, value: value });
  }
  executorRangeWidth /= 10;
}


// Graphite helper functions, for query-construction clarity
// elsewhere in this file.
function aliasSub(target, find, repl) {
  return "aliasSub(" + target + ", '" + find + "', '" + ((repl == undefined) ? "\\1" : repl) + "')";
}
function aliasByExecutorId(target) {
  return aliasSub(target, '^[^.]+\\.([^.]+)\\..*');
}
function alias(target, name) { return "alias(" + target + ", '" + name + "')"; }
function percentileOfSeries(target, percentile) {
  return "percentileOfSeries(" + target + ", " + percentile + ", 'false')";
}
function summarize(target, interval, fn) {
  return "summarize(" + target + ", '" + (interval || '10s') + "', '" + (fn || 'avg') + "', false)";
}
function nonNegativeDerivative(target) { return "nonNegativeDerivative(" + target + ")"; }
function perSecond(target) { return "perSecond(" + target + ")"; }
function sumSeries(target) { return "sumSeries(" + target + ")"; }
function prefix(target, range) { return "$prefix." + (range || '$executorRange') + ".executor." + target; }


// Some panel-JSON-construction helpers.
function legend(show) { return { show: show, hideEmpty: true }};

// Merge two objects.
function merge(src, dest) {
  if (src) {
    for (var k in src) {
      if (src.hasOwnProperty(k)) {
        if (dest.hasOwnProperty(k) && typeof(src[k]) == 'object') {
          dest[k] = merge(src[k], dest[k]);
        } else {
          dest[k] = src[k];
        }
        if (k == 'pointradius' && src[k] > 0) {
          dest.points = true;
        }
      }
    }
  }
  return dest;
}

// Base function to set some boilerplate panel-configuration values.
function panel(title, targets, opts, showLegend) {
  var legendVar = (showLegend == undefined) ? legends : showLegend;
  console.log(legendVar);
  return merge(
        opts,
        {
          title: title,
          span: 4,
          type: "graph",
          nullPointMode: "null",
          tooltip: {
            shared: sharedTooltip
          },
          legend: legend(legendVar),
          targets: targets.map(function(target) { return { target: target }; })
        }
  );
}

// Return a panel displaying JVM stats for an executor or driver.
function executorJvmPanel(id, opts) {
  opts = opts || {};
  opts.nullPointMode = 'connected';
  return panel(
        id + ": GC tiers / generations",
        [
          aliasSub(
                aliasSub(
                      "$prefix." + id + ".jvm.pools.*.usage",
                      "^.*\\.([^.]*)\\.usage.*"
                ),
                "(PS-)?(-Space)?-?",
                ""
          ),
          aliasSub(
                "$prefix." + id + ".jvm.{non-heap,heap}.usage",
                ".*\\.((non-)?heap)\\..*"
          )
        ],
        opts
  );
}

// Return a panel showing one metric over many executors.
function multiExecutorPanel(title, target, opts, percentiles, fns) {
  var targets = [];
  function makeFullTarget(range) {
    var fullTarget = summarize(prefix(target, range));
    (fns || []).forEach(function(fn) {
      fullTarget = fn(fullTarget);
    });
    return fullTarget;
  }

  targets.push(aliasByExecutorId(makeFullTarget()));
  (percentiles || []).forEach(function(percentile) {
    if (percentile == 'total') {
      targets.push(
            alias(
                  sumSeries(
                        makeFullTarget('*')
                  ),
                  'total'
            )
      );
    } else {
      targets.push(
            alias(
                  percentileOfSeries(
                        makeFullTarget('*'),
                        percentile
                  ),
                  percentile + "%"
            )
      );
    }
  });

  opts = opts || {};
  opts.seriesOverrides = opts.seriesOverrides || [{
    alias: "/total/",
    yaxis: 2,
    linewidth: 4,
    lines: true
  }, {
    alias: "/%/",
    linewidth: 5,
    lines: true
  }];

  return panel(title, targets, opts);
}


// Dashboard boilerplate.
var dashboard = {
  title: app.prefix,
  rows: [],
  style: "light",
  time: {
    from: app.from,
    to: app.to,
    now: app.now
  },
  templating: {
    enable: true,
    list: [
      prefixTemplateVar,
      executorRangeTemplateVar,
      driverTemplateVar
    ]
  }
};

// A "row" with many per-executor graphs.
var executor_row = {
  title: "Executor JVMs",
  height: "300px",
  editable: true,
  collapse: collapseExecutors,
  panels: []
}

// Add panels to the executor row based on the "executors" query
// param, if present; otherwise, use create @maxExecutorId panels.
if (executorRanges.length) {
  executorRanges.forEach(function(executorRange) {
    for (var executorId = executorRange.from; executorId <= executorRange.to; ++executorId) {
      executor_row.panels.push(executorJvmPanel(executorId, { span: 3, legend: legend(executorLegends) }));
    }
  });
} else {
  for (var executorId = 1; executorId <= maxExecutorId; ++executorId) {
    executor_row.panels.push(executorJvmPanel(executorId, { span: 3 }));
  }
}


// A "row" with panels about the #'s of active and completed tasks.
var threadpool_row = {
  title: "threadpool",
  height: "300px",
  panels: [
    multiExecutorPanel(
          "Active tasks (stacked per executor)",
          "threadpool.activeTasks",
          {
            stack: true,
            fill: 10,
            nullPointMode: 'null as zero',
            tooltip: {
              value_type: "individual",
            }
          }
    ),
    multiExecutorPanel(
          "Completed tasks per executor",
          "threadpool.completeTasks",
          {},
          percentilesAndTotals ? ['total'] : []
    ),
    panel(
          "Completed tasks per minute per executor",
          [
            aliasByExecutorId(
                  nonNegativeDerivative(
                        summarize(
                              prefix("threadpool.completeTasks"),
                              '1m'
                        )
                  )
            )
          ],
          { pointradius: 1 }
    )
  ]
};


// A "row" with driver-specific stats.
var driver_row = {
  title: "Driver JVM / GC",
  height: "250px",
  editable: true,
  collapse: false,
  panels: [
    panel(
          "Driver scavenge GC",
          [
            alias("$prefix.$driver.jvm.PS-Scavenge.count", "GC count"),
            alias("$prefix.$driver.jvm.PS-Scavenge.time", "GC time")
          ],
          {
            nullPointMode: 'connected',
            seriesOverrides: [
              {
                alias: "GC time",
                yaxis: 2
              }
            ]
          }
    ),
    executorJvmPanel("$driver"),
    panel(
          "Driver GC Time/s",
          [ alias(perSecond(summarize("$prefix.$driver.jvm.PS-Scavenge.time")), 'GC time') ],
          {
            nullPointMode: 'connected',
            pointradius: 1
          }
    )
  ]
};


// A "row" with HDFS I/O stats.
var hdfs_row =     {
  title: "HDFS I/O",
  height: "300px",
  editable: true,
  collapse: false,
  panels: [
    multiExecutorPanel(
          "HDFS reads/s",
          "filesystem.hdfs.read_ops",
          {
            span: 6,
            pointradius: 1,
            steppedLine: true,
            seriesOverrides: [
              {
                alias: "/total/",
                linewidth: 4,
                yaxis: 2
              },
              {
                alias: "/%/",
                linewidth: 3
              }
            ]
          },
          percentilesAndTotals ? [ 25, 50, 75, 'total' ] : [],
          [ perSecond ]
    ),
    multiExecutorPanel(
          "HDFS reads/executor",
          "filesystem.hdfs.read_ops",
          {
            span: 6,
            seriesOverrides: [
              {
                alias: "/total/",
                linewidth: 4,
                yaxis: 2
              },
              {
                alias: "/%/",
                linewidth: 3
              }
            ]
          },
          percentilesAndTotals ? [ 25, 50, 75, 'total' ] : []
    ),
    multiExecutorPanel(
          "HDFS bytes read/s/executor",
          "filesystem.hdfs.read_bytes",
          {
            y_formats: [
              "bytes",
              "bytes"
            ],
            span: 6,
            seriesOverrides: [
              {
                alias: "/total/",
                linewidth: 4,
                yaxis: 2
              },
              {
                alias: "/%/",
                linewidth: 3
              }
            ]
          },
          percentilesAndTotals ? [ 25, 50, 75, 'total' ] : [],
          [ perSecond ]
    ),
    multiExecutorPanel(
          "HDFS bytes read",
          "filesystem.hdfs.read_bytes",
          {
            y_formats: [
              "bytes",
              "bytes"
            ],
            span: 6
          },
          percentilesAndTotals ? [ 5, 50, 95, 'total' ] : []
    ),
  ],
}


// A "row" with metrics about the carbon daemon.
var carbon_row = {
  title: "Carbon row",
  height: "250px",
  editable: true,
  collapse: false,
  panels: [
    panel(
          "Carbon Stats - metrics collected, points per update",
          [
            alias("carbon.agents.*.metricsReceived", "metrics recv'd"),
            alias("carbon.agents.*.pointsPerUpdate", "points/update"),
            alias("carbon.agents.*.avgUpdateTime", "updateTime"),
            alias("carbon.agents.*.errors", "errors"),
          ],
          {
            legend: legend(true),
            seriesOverrides: [
              {
                alias: "/metrics/",
                yaxis: 2
              }
            ]
          }
    ),
    panel(
          "Carbon Stats - updates, queues",
          [
            alias("carbon.agents.*.updateOperations", "updates"),
            alias("carbon.agents.*.cache.queues", "cache.queues")
          ],
          {
            legend: legend(true),
            seriesOverrides: [
              {
                alias: "updates",
                yaxis: 2
              }
            ]
          }
    ),
    panel(
          "Carbon Stats - mem usage",
          [
            alias("carbon.agents.*.cache.size", "cache.size"),
            alias("carbon.agents.*.memUsage", "memUsage")
          ],
          {
            legend: legend(true),
            seriesOverrides: [
              {
                alias: "memUsage",
                yaxis: 1
              },
              {
                alias: "cache.size",
                yaxis: 2
              },
            ]
          }
    )
  ]
};


// The dashboard, with its rows.
dashboard.rows = [
  executor_row,
  threadpool_row,
  driver_row,
  hdfs_row,
  carbon_row
];

console.log("Returning: %O", dashboard);

return dashboard;
