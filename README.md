# grafana-spark-dashboards

This repository contains a Grafana "scripted dashboard", `spark.js`, designed to display metrics collected from Spark applications.

## What You'll See

Beautiful graphs of all of your Spark metrics!

![Screenshot of Spark metrics dashboard][]

## What's Under the Hood

Here's a diagram of most of the pieces involved in our Spark-on-YARN + Graphite + Grafana infrastructure that contributes to the above graphs:

![Gliffy diagram of Spark metrics infrastructure][Spark gliffy]

## Installation

There are several pieces that need to be installed and made to talk to each other here:

1. Install Graphite.
1. Configure Spark to send metrics to your Graphite.
1. Install Grafana with your Graphite as a data source.
1. Install your scripted dashboard in your Grafana installation (don't worry; just a symlink).
1. Configure your scripted dashboard (don't worry; just a hostname find&replace).

Each of these steps is at least briefly discussed below.

### Install Graphite

This can be an arduous process, but try following the instructions at the [Graphite docs][] or in the [various][graphite1] [guides][graphite2] [around the internet][synthesize].

### Configure Spark to Send Metrics to Graphite.

[This StackOverflow answer that I wrote][MetricsSystem SO answer] explains the process for configuring Spark to send metrics to Graphite.

### Install and Configure Grafana

The [Grafana docs][] are pretty good, but a little lacking the "quick start" department. The basic steps you need to follow are:

```
git clone git@github.com:grafana/grafana.git
cd grafana
ln -s config.sample.js src/config.js  # create src/config.js from the provided sample.
<edit src/config.js: uncomment Graphite section and set the hostname:port to your Graphite's.>
```

[Here][src/config.js] is an example `src/config.js` that I use, with hostnames and ports redacted.

#### Install and Configure `nginx`

Again, [primary docs][nginx docs] are always a good place to go, but [here is an example `nginx.conf`][nginx.conf] that I use that serves my Grafana files.

#### Optional: Install and Configure Elasticsearch

If you want to use Grafana's dashboard-saving and -loading functionality, the easiest thing to do is to point it at an `elasticsearch` instance.

Install Elasticsearch, run it on the default port `9200`, and don't delete [the elasticsearch portion of the sample `src/config.js`][config.js ES] I showed you.

After the above steps, you should be able to go to you `<grafana host>:8090` and see stub "random walk" graphs.

### Install Scripted Dashboard in Grafana

This is easy:

```
ln -s $THIS_REPO/spark.js $GRAFANA_REPO/src/app/dashboards/spark.js
```

Now you should be able to go to [http://<grafana host>:8090/#/dashboard/script/spark.js?app=$YARN_APP_ID&maxExecutorId=$N](), substituting values for the URL-params values, and see a Spark dashboard!

## `spark.js` URL API

Here are the URL parameters that you can pass to `spark.js`:

### Important / Required Parameters

#### `&app=<YARN app ID>`
Using this is highly recommended: any unique substring of a YARN application ID that you can see on your ResourceManager's web UI will do.

For example, to obtain graphs for my latest job shown here:

![Yarn ResourceManager screenshot][]

I can simply pass `?app=0006` to `spark.js`.

This will hit your ResourceManager's JSON API (via [the proxy you've set up on the same host, port `8091`][YARN RM proxy]), find the application that matches `0006`, and pull in:

* the application ID, which by default is the first segment of all metric names that Spark emits,
* the start time, and
* the end time, or a sentinel "now" value if the job is still running.

If you are not specifying the `app` parameter, then the next three parameters should be included:

#### `&prefix=<metric prefix>`
Pass the full application ID (which is the YARN application ID if you are running Spark on YARN, otherwise the `spark.app.id` configuration param that your Spark job ran with) here if it is not fetched via the `app` parameter documented above.

#### `&from=YYYYMMDDTHHMMSS`, `&to=YYYYMMDDTHHMMSS`
These will be inferred from the YARN application if the `app` param is used, otherwise they should be set manually; defaults are `now-1h` and `now`.

#### `&maxExecutorId=<N>`
Tell `spark.js` how many per-executor graphs to draw, and how to initialize some sane values of the `$executorRange` [template variable][Grafana templates].

### Miscellaneous / Optional Parameters

#### `&collapseExecutors=<bool>`
Collapse the top row containing per-executor JVM statistics, which can commonly be quite large and take up many folds of screen-height.

Default: `true`.

#### `&executors=<ranges>`
Comma-delimited list of dash-delimited pairs of integers denoting specific executors to show.

All ranges passed here, as well as their union, will be added as options to the `$executorRange` template variable.

Example: `1-12,22-23`.

#### `&sharedTooltip=<bool>`
Toggle whether each graph's tooltip shows values for every plotted metric at a given x-axis value or for just a single metric that's being moused over.

Default: `true`.

#### `&executorLegends=<bool>`
Show legends on per-executor graphs.

Default: `true`.

#### `&legends=<bool>`
Show legends on graphs other than per-executor ones discussed above.

Default: `false`. Many of these panels can plot 100s of executors at the same time, causing the legend to be cumbersome.

#### `&percentilesAndTotals=<bool>`
Render `n`th-percentiles and sums on certain graphs; can slow down rendering.

Default: `false`.

## `spark.js` Templated Variables

`spark.js` exposes three templated variables that can be dynamically changed and cause dashboard updates:

![spark.js templated variables][]

* `$prefix`: the first piece of your Spark metrics' names; analogous to the `prefix` URL param.
* `$executorRange`: ranges of executors to restrict graphs that plot multiple executors' values of a given metric to.
* `$driver`: typically unused; when sending metrics from Spark to Graphite via StatsD, the "driver" identifier can lose its angle-brackets. This variable provides an escape hatch in that situation.

## Troubleshooting

Please file issues if you run into any problems, as this is fairly "alpha".





[Graphite docs]: http://graphite.readthedocs.org/en/latest/
[graphite1]: http://kaivanov.blogspot.com/2012/02/how-to-install-and-use-graphite.html
[graphite2]: https://www.digitalocean.com/community/tutorials/how-to-install-and-use-graphite-on-an-ubuntu-14-04-server
[synthesize]: https://github.com/obfuscurity/synthesize/
[MetricsSystem SO answer]: http://stackoverflow.com/a/28731852/544236
[Grafana docs]: http://grafana.org/docs/
[src/config.js]: https://gist.github.com/ryan-williams/21fe3d602e6e83c76063#file-src-config-js
[nginx docs]: http://wiki.nginx.org/Install
[nginx.conf]: https://gist.github.com/ryan-williams/21fe3d602e6e83c76063#file-nginx-conf
[config.js ES]: https://gist.github.com/ryan-williams/21fe3d602e6e83c76063#file-src-config-js-L17-L22
[YARN RM proxy]: https://gist.github.com/ryan-williams/21fe3d602e6e83c76063#file-nginx-conf-L36-L44
[Screenshot of Spark metrics dashboard]: http://f.cl.ly/items/3p040F0T1n2n1K3L0o2t/Screen%20Shot%202015-02-26%20at%206.57.08%20PM.png
[Spark gliffy]: http://f.cl.ly/items/272x3z1G3O3Y1W3T170q/spark_metrics%2520(1).png
[Yarn ResourceManager screenshot]: http://f.cl.ly/items/2Z1I3Z3d1D2M33022U3B/Screen%20Shot%202015-02-26%20at%207.16.13%20PM.png
[Grafana templates]: http://grafana.org/docs/features/templated_dashboards/
[spark.js templated variables]: http://f.cl.ly/items/0c3p0q0R1V2z0P1S1v0Y/Screen%20Shot%202015-02-26%20at%207.35.19%20PM.png
