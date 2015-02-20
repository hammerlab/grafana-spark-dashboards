/* global _ */

'use strict';

// accessable variables in this scope
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

var max_executor_id = getIntParam(ARGS.executors, 20);

var now = false;
var collapseExecutorRow = getBoolParam(ARGS.collapseExecutorRow, true);
var sharedTooltip = getBoolParam(ARGS.sharedTooltip, true);
var executorLegends = getBoolParam(ARGS.executorLegends, true);

function parsePanel(filename) {
  var panelJSON = null;
  jQuery.ajax('http://demeter-login2.demeter.hpc.mssm.edu:8091/panel/' + filename, {
    async: false,
    dataType: 'json',
    success: function(data) {
      panelJSON = data;
    },
    error: function(xhr, status, err) {
      console.error(xhr, status, err);
    },
  });
  return panelJSON;
}


function fetchApps() {
  var apps = null;
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

function findApp(appId) {
  console.log("finding app: " + appId);
  var apps = fetchApps();
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

function getAppInfo() {
  if (_.isUndefined(ARGS.app) && _.isUndefined(ARGS.name)) {
    throw new Error("'app' xor 'name' URL parameter required");
  }
  if (!_.isUndefined(ARGS.app)) {
    var app = findApp(ARGS.app);
    if (!_.isUndefined(ARGS.prefix)) {
      app.prefix = ARGS.prefix;
    }
    return app;
  }
  if (!_.isUndefined(ARGS.name)) {
    var from = getFrom();
    var to = getTo();
    var now = (to == 'now');
    return {
      id: ARGS.name,
      now: now,
      from: from,
      to: to,
    };
  } else {
    return ;
  }
}

var app = getAppInfo();

console.log("now? " + app.now);
console.log("max executors: " + max_executor_id);

var dashboard = {
  title: app.prefix,
  rows: [],
  style: "light",
  hideAllLegends: true,
  time: {
    from: app.from,
    to: app.to,
    now: app.now,
  },
  templating: {
    enable: true,
    list: [
      {
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
      },
      {
        type: "custom",
        name: "executorRange",
        query: "",
        options: [
          {
            text: "1-10",
            value: "{[1-9],10}"
          },
          {
            text: "11-20",
            value: "{1[1-9],20}"
          },
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
      },
      {
        type: "custom",
        name: "driver",
        query: "",
        options: [
          { text: "driver", value: "driver" },
          { text: "<driver>", value: "<driver>" }
        ],
        current: { text: "<driver>", value: "<driver>" }
      }
    ]
  }
};

// A "row" with many per-executor graphs.
var executor_row = {
  title: "Executor JVMs",
  height: "350px",
  editable: true,
  collapse: collapseExecutorRow,
  panels: []
}

function executorPanel(id, targets, opts) {
  return merge(
        opts,
        {
          title: id + ": GC tiers / generations",
          span: 3,
          type: "graph",
          tooltip: {
            shared: sharedTooltip
          },
          legend: {
            show: executorLegends
          },
          targets: targets.map(function(target) { return { target: target }; }),
        }
  );
}

function executorJvmPanel(id, opts) {
  return executorPanel(
        id,
        [
          "aliasSub(aliasSub($prefix." + id + ".jvm.pools.*.usage, '^.*\\.([^.]*)\\.usage.*', '\\1'), '(PS-)?(-Space)?-?', '')",
          "aliasSub($prefix." + id + ".jvm.{non-heap,heap}.usage, '.*\\.((non-)?heap)\\..*', '\\1')"
        ],
        opts
  );
}

for (var executor_id = 1; executor_id <= max_executor_id; ++executor_id) {
  executor_row.panels.push(executorJvmPanel(executor_id));
}

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

function panel(title, targets, opts) {
  var json = {
    title: title,
    span: 4,
    type: "graph",
    legend: {
      show: false
    },
    nullPointMode: "null",
    tooltip: {
      shared: sharedTooltip
    },
    targets: targets.map(function(target) { return { target: target }; }),
  };
  return merge(opts, json);
}

function aliasByExecutorId(target) {
  return "aliasSub(" + target + ", '^[^.]+\\.([^.]+)\\..*', '\\1')";
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
                        makeFullTarget()
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
    multiExecutorPanel("Completed tasks per executor", "threadpool.completeTasks", {}, ['total']),
    panel(
          "Completed tasks per minute per executor",
          [ aliasByExecutorId(nonNegativeDerivative(summarize(prefix("threadpool.completeTasks"), '1m'))) ],
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
            ],
          }
    ),
    executorJvmPanel("$driver", { span: 4 }),
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
            lines: false,
            pointradius: 1,
            seriesOverrides: [
              {
                alias: "/total/",
                linewidth: 4,
                yaxis: 2,
                lines: true
              },
              {
                alias: "/%/",
                linewidth: 1,
                lines: true
              }
            ],
          },
          [ 25, 50, 75, 'total' ],
          [ perSecond ]
    ),
    multiExecutorPanel("HDFS reads/executor", "filesystem.hdfs.read_ops"),
    multiExecutorPanel("HDFS reads/s/executor", "filesystem.hdfs.read_ops", { steppedLine: true }, [], [ perSecond ]),
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
          [5,50,95,'total']
    ),
    multiExecutorPanel(
          "HDFS bytes read/s/executor",
          "filesystem.hdfs.read_bytes",
          {
            y_formats: [
              "bytes",
              "bytes"
            ],
            span: 6
          },
          [],
          [ perSecond ]
    )
  ]
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
            legend: { show: true },
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
            legend: { show: true },
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
            legend: { show: true },
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
