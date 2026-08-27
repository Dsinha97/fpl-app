FPL Analytics & Decision Support App
====================================

Website Optimization — NotebookLM Source Export
=================================================

> **Provenance.** Exported 2026-08-27 from the owner's NotebookLM notebook *Website
> Optimization* (created 2026-08-27T18:00:23Z) using
> [`teng-lin/notebooklm-py`](https://github.com/teng-lin/notebooklm-py). The notebook holds
> 66 web sources (56 loaded successfully, 10 failed to fetch — listed at the end) plus one
> authored synthesis document, reproduced below in full. No saved notes existed on the
> notebook at export time.
>
> **This is unfiltered external research material, not a plan for this app.** The synthesis
> below is written for a generic "statistics-heavy dashboard" and assumes infrastructure this
> app does not have and, per `CLAUDE.md`'s non-goals, is not adopting on the strength of this
> document alone — a server, a WebSocket/SSE channel, a queryable OLAP database. Which parts
> apply to fpldecision.com — a static Next.js export on Cloudflare Workers static assets, backed
> by Supabase Postgres and read entirely client-side — is worked out against a measured
> baseline in [`docs/sprints/latency.md`](../sprints/latency.md), not assumed from this text.
> Treat every recommendation here as a hypothesis to be checked against this app's own
> numbers, not an instruction.

---

### Architectural Optimization of High-Latency, Analytics-Intensive Web Platforms

#### Structural Latency Paths in Modern Analytical Applications

Modern web applications that display dense statistical metrics and visual panels depend on complex, multi-tiered architectures to process, transmit, and render data [cite: 1, 2]. Latency in these platforms is rarely caused by a single isolated component [cite: 1, 2]. Instead, it stems from the combined inefficiencies of database execution, API payload serialization, network protocols, client-side state management, and main-thread graphics rendering [cite: 1]. When any of these components are misconfigured, users experience visible interface lag, high interaction delays, and overall slower page loads [cite: 1, 2].
To build a highly responsive application, architects must design for specific, measurable goals [cite: 1]. These include minimizing the time to first visual paint, reducing interaction latency during user filtering, ensuring stable execution under high concurrent user loads, and managing infrastructure costs [cite: 1]. Optimizing this pipeline requires coordinating performance enhancements across four key areas: database storage structures, network transport mechanisms, client state libraries, and browser rendering engines [cite: 1, 3].

---

#### Database Infrastructure and Storage Tier Engineering

The database engine is the foundation of any analytics application, and its storage architecture largely dictates downstream performance [cite: 1, 3]. Standard relational databases are optimized for Online Transaction Processing (OLTP) but scale poorly when executing aggregation queries over millions of historical records [cite: 3, 4].

##### Storage Engines and Columnar Optimization

For analytical workloads (OLAP), using column-oriented database architectures drastically reduces physical disk I/O [cite: 4, 5]. Relational engines write and read data in complete horizontal rows, which forces the system to load unused columns from disk during aggregation queries [cite: 4]. In contrast, columnar systems group data on disk by column, allowing the engine to extract only the specific attributes needed to compute averages, sums, or trends [cite: 4].

| Architectural Feature | Traditional Relational Engine (e.g., PostgreSQL) | Columnar OLAP Engine (e.g., ClickHouse) | Time-Series Hybrid Engine (e.g., TimescaleDB) |
| ------ | ------ | ------ | ------ |
| **Physical Storage Format** | Row-oriented blocks on disk [cite: 4]. | Pure column-oriented blocks [cite: 4, 6]. | Hybrid row/column storage based on chunk age [cite: 6]. |
| **Read Mechanics** | Full-row scanning, highly dependent on B-Tree indexes [cite: 4, 5]. | Selective column scanning, skipping unused attributes entirely [cite: 4, 7]. | Automatic time-based partitioning with targeted chunk pruning [cite: 5, 6]. |
| **Typical Compression Ratio** | Low (typically 1.5–2x on text data). | High (10–40x due to similar data grouping) [cite: 5, 6]. | Dynamic (5–20x depending on columnar policy) [cite: 5, 6]. |
| **Point Query Performance** | Extremely fast (ideal for unique lookups) [cite: 4, 5]. | Slow (requires scanning primary key granules) [cite: 5, 6]. | Fast (leverages relational indices on active chunks) [cite: 5]. |
| **Complex Join Execution** | Highly optimized and ACID compliant [cite: 4, 5]. | Expensive; requires denormalization or star-schemas [cite: 5, 8]. | Highly optimized (retains full relational support) [cite: 5]. |

Columnar databases achieve high compression ratios because adjacent data points share the same data type, enabling highly efficient run-length or dictionary encoding [cite: 4, 6]. This structural design makes columnar engines the standard for high-throughput statistics platforms, whereas hybrid engines like TimescaleDB balance analytical performance with relational joins [cite: 5, 6].

##### Multi-Tier Aggregations and Parallel Query Design

Pre-aggregating datasets at write-time prevents expensive real-time computational costs when a user loads a dashboard [cite: 9, 10]. Database architectures should employ multi-tiered materialized views or automated aggregate tables to keep query paths lightweight [cite: 3, 9].
Materialized views store pre-calculated queries on disk [cite: 3, 10]. In databases like PostgreSQL, these views are static snapshots that require complete manual refreshes [cite: 11]. Conversely, columnar systems like ClickHouse support Incremental Materialized Views, which operate like insert-time triggers [cite: 12]. As new blocks of raw data are written, the view processes only the incoming stream and records intermediate aggregation states into a separate target table [cite: 12]. This minimizes write-time overhead while ensuring that queries can quickly finalize values on the fly [cite: 12].
TimescaleDB manages this process through Continuous Aggregates [cite: 13, 14]. These views track a materialization watermark to differentiate between pre-computed historical segments and incoming raw writes [cite: 13, 14]. Continuous aggregates run in two modes:

* **Real-Time Union Mode**: The query engine reads pre-calculated summary rows up to the watermark and simultaneously aggregates the remaining raw data on the fly [cite: 13, 14]. This approach ensures that metrics are accurate up to the current second, though it introduces a slight latency penalty [cite: 13, 14].
* **Materialized-Only Mode**: The engine queries only the pre-computed summary table and bypasses the raw tables entirely [cite: 14]. This delivers highly predictable, sub-second query times, though it excludes the most recent unmaterialized data [cite: 14].

For massive datasets spanning billions of rows, a time-segmented parallel query architecture can prevent timeouts [cite: 9]. The execution path divides incoming date ranges into separate buckets: historical data mapped to pre-aggregated weekly tables, mid-range data mapped to daily tables, and the current day's data mapped directly to raw tables [cite: 9]. Utilizing parallel Common Table Expressions (CTEs) to query these tables concurrently, and then merging the result sets, can reduce query times from minutes to seconds [cite: 9].

##### Partitioning, Sorting, and Indexing Strategies

Proper data placement on disk is critical to speed up table scanning [cite: 1, 7]. Table definitions must specify physical sorting keys that match the application's most common query patterns [cite: 7].
In columnar databases, physical sorting dictates how effectively the engine can skip irrelevant rows [cite: 7]. Architects should place low-cardinality filtering fields (such as tenant identifiers or category flags) first in the sorting sequence, followed by high-cardinality fields (such as timestamps) [cite: 7]. As data is written, the database creates primary index pointers at the start of each data block (granule) [cite: 7]. When a query filters by a primary column, the planner uses these pointers to skip entire granules, avoiding unnecessary disk reads [cite: 7].
For wide tables, vertical table partitioning can isolate infrequently accessed columns into distinct physical structures, reducing the data volume scanned during standard reads [cite: 3]. Additionally, horizontal partitioning separates large datasets into distinct temporal files (such as monthly directories) [cite: 3, 15]. When queries filter on these partition columns, the query planner immediately narrows its search to the matching directories [cite: 3].

---

#### Network Transport Protocols and Serialization Frameworks

After the database processes a query, the resulting data must travel across the network and reach the client [cite: 1]. The choice of pagination, serialization, and transport protocols directly affects network latency and server CPU usage [cite: 16, 17].

##### Keyset Pagination and Database Access Patterns

To display large tables or infinite lists, applications must avoid traditional offset-based pagination [cite: 17, 18]. Offset pagination uses the SQL structure:

```
SELECT * FROM table ORDER BY id LIMIT M OFFSET N
```

This approach exhibits O(N) computational complexity [cite: 17, 18]. The database engine must scan, evaluate, and discard all N preceding rows before returning the M target records [cite: 17, 18, 19]. Additionally, when items are inserted or deleted between requests, rows shift across page boundaries, causing duplicate listings or missing items in the UI [cite: 18].
Keyset or cursor-based pagination resolves this inefficiency [cite: 17, 18]. The client tracks a stable value from the last retrieved row (such as an indexed identifier or a timestamp combination) and passes this "cursor" back with the next request [cite: 17, 18, 20]:

```
SELECT * FROM table WHERE (created_at, id) < (cursor_timestamp, cursor_id) ORDER BY created_at DESC, id DESC LIMIT M
```

Because the WHERE clause targets indexed columns, the query planner performs a fast O(log N) search on a B-Tree index to locate the starting point directly, ensuring consistent execution times even at high page depths [cite: 17, 19].

| Performance Dimension | Offset-Based Pagination | Cursor-Based Keyset Pagination |
| ------ | ------ | ------ |
| **Algorithmic Complexity** | O(N) (latency scales with offset depth) [cite: 17, 18]. | O(log N) (stable, predictable execution) [cite: 17, 19]. |
| **Database Disk Access** | High (frequently scans and discards rows) [cite: 17, 18]. | Low (seeks directly to index coordinates) [cite: 17, 19]. |
| **Real-Time Data Consistency** | Unstable (rows shift, causing duplicates) [cite: 18]. | Stable (anchored to the cursor coordinates) [cite: 18, 19]. |
| **Result Window Access** | Supports jumping to arbitrary page numbers [cite: 17, 19]. | Limited to sequential forward/backward navigation [cite: 17, 18]. |
| **Database Aggregation Cost** | Requires high-overhead COUNT(*) calculations [cite: 17, 18]. | Bypasses total-count requirements [cite: 18]. |

##### Serialization Formats and Payload Overhead

Traditional text-based JSON is a common choice for APIs, but its verbosity and parse overhead can create latency bottlenecks [cite: 16, 21]. JSON requires CPU-intensive string parsing, uses reflection on the server, and repeats object keys for every row in a dataset [cite: 16, 21]. Upgrading to binary serialization formats can significantly improve network throughput and reduce serialization latencies [cite: 16, 21].

| Serialization Protocol | Payload Footprint | CPU & Memory Overhead | Schema Model | Ideal Integration Path |
| ------ | ------ | ------ | ------ | ------ |
| **JSON** | Baseline (verbose text, repeated keys) [cite: 16, 21]. | High (runtime reflection, string parsing) [cite: 21, 22]. | Dynamic (no schema required) [cite: 16, 23]. | Public APIs and administrative debugging endpoints [cite: 21, 23]. |
| **MessagePack** | Compact (15–40% smaller than JSON) [cite: 16, 23]. | Low (direct type encoding) [cite: 16, 21]. | Dynamic (schema-optional wrapper) [cite: 16, 23]. | Drop-in JSON replacement for internal caching [cite: 16, 21, 23]. |
| **Protocol Buffers** | Highly Compact (45–75% smaller than JSON) [cite: 16, 21, 23]. | Minimal (statically compiled data streams) [cite: 21, 24]. | Strict (pre-compiled proto syntax) [cite: 16, 21, 23]. | Real-time APIs and internal microservices [cite: 21, 23]. |
| **FlatBuffers** | Moderately Compact (contains offset tables) [cite: 16]. | Near-Zero (zero-copy memory mapping) [cite: 16]. | Strict (pre-compiled schema definitions) [cite: 16]. | High-frequency rendering and real-time gaming [cite: 16]. |
| **CBOR** | Compact (similar to MessagePack) [cite: 16]. | Medium (slower on dynamic runtimes) [cite: 16]. | Dynamic (standardized binary format) [cite: 16]. | IoT environments and identity assertions [cite: 16]. |
| **BSON** | Verbose (includes storage metadata) [cite: 25]. | Low (optimized for in-place modifications) [cite: 25]. | Dynamic (BSON-to-JSON maps) [cite: 25]. | Local document store systems [cite: 25]. |

Protocol Buffers (Protobuf) serialize data against a pre-compiled schema, mapping fields to short numeric keys to strip out redundant text identifiers [cite: 16, 23]. In high-throughput systems, this reduces CPU utilization, lowers garbage collection pressure, and cuts network payload sizes in half [cite: 21, 24]. For applications that require dynamic flexibility without upfront schemas, MessagePack serves as an efficient drop-in replacement for JSON, reducing payload sizes by up to 40% [cite: 16, 23].

##### High-Ratio Compression and Gateway Delivery Strategies

After selecting an API serialization format, applying compression algorithms further optimizes network transit times [cite: 26, 27]. Servers should prioritize Brotli compression over standard Gzip [cite: 27, 28].
Brotli uses a 16 MB sliding dictionary — compared to Gzip's 32 KB window — and pre-loads a static dictionary of common web strings (like HTML tags and JSON keys) to achieve superior compression ratios [cite: 28, 29]. Because Brotli's maximum compression level (level 11) is highly CPU-intensive, architects should deploy a dual-tiered compression strategy [cite: 27, 28]:

* **Static Asset Pre-Compression**: Compile client-side dashboard scripts, styling engines, and template assets at build time using Brotli level 11 [cite: 28, 29]. This achieves the highest possible compression ratio with zero runtime performance cost [cite: 28, 29].
* **Dynamic On-the-Fly Compression**: Compress dynamic database API payloads on the fly using a moderate Brotli level (level 4 to 6) [cite: 27, 29]. This balances payload reduction with server CPU load to prevent delays in Time to First Byte (TTFB) [cite: 27, 29].

For fallback paths, keep Gzip active to support legacy browsers (the remaining 3% to 5% of web clients) [cite: 27, 28].

##### Dynamic Client-Server Transport Protocols

The bidirectional demands of an application dictate which transport protocol is best suited for real-time updates [cite: 30, 31].
If client interactions frequently trigger server state changes, WebSockets or WebTransport provide full-duplex communication channels [cite: 32, 33]. WebSockets upgrade standard HTTP connections into persistent TCP streams to eliminate the overhead of repeated request-response headers [cite: 31, 34]. However, WebSockets are susceptible to head-of-line blocking: if a single TCP packet is dropped, the entire stream halts until that packet is retransmitted [cite: 35, 36].
WebTransport addresses this by running over HTTP/3 and the QUIC protocol, enabling multiplexed, independent streams [cite: 35, 37]. If one stream drops a packet, other streams continue processing unaffected [cite: 35, 38]. Additionally, WebTransport features a faster 1-RTT connection handshake and supports 0-RTT for returning users, which reduces latency on unstable connections [cite: 36].
When designing real-time updates, architects must also prevent socket connection storms [cite: 39]. Benchmarks show that opening numerous socket connections simultaneously causes network resource contention [cite: 39]. For example, opening sixteen WebSocket connections sequentially takes only ~193 ms — making it 10x to 18x faster than opening them all at once [cite: 39].

---

#### Client-Side UI Orchestration and State Architecture

A high-performance backend must be paired with efficient client-side orchestration to ensure a smooth, responsive user interface [cite: 1].

##### Query-Shaping and Interface Landing Optimization

To handle dashboards with multiple statistical displays, client applications must manage how they trigger API requests to prevent backend bottlenecks [cite: 1]. Single-page dashboard designs that query data for every widget simultaneously create massive concurrency spikes, which can overload server queues [cite: 1].
To optimize this landing experience, interfaces should use a multi-tab or multi-page architecture that only requests data for the visible viewport [cite: 1]. This distributes server load and speeds up the initial page render [cite: 1]. High-performance dashboards should prioritize the landing view by applying selective filtering defaults [cite: 1]:

* **Temporal Scoping**: Default date range selectors to the last 7 or 30 days rather than loading the entire historical archive [cite: 1].
* **Categorical Preselection**: Preselect specific dimensions (such as a single region or business unit) to narrow the query scope [cite: 1].
* **Selective "All" Criteria**: Map broad filters to a sensible limit (like the current fiscal year) instead of querying the full history [cite: 1].

Additionally, dashboard designs should avoid heavy visual components — such as dense maps or complex network graphs — on the initial landing page, using simplified charts instead to speed up early renders [cite: 2].

##### Caching Topologies and Local Processing Limits

Modern web browsers can function as local execution engines to reduce round-trips to the server [cite: 1]. When datasets are small (under 100,000 rows and under 100 MB), the client should load the data once and perform all filtering, sorting, and cross-chart aggregation locally in memory [cite: 1]. If the data exceeds these thresholds, calculations should be offloaded back to the analytical database [cite: 1].
To make local caching highly effective, query shapes must remain deterministic [cite: 1]:

* **Avoid Non-Deterministic Functions**: Eliminate operations like NOW() or current_timestamp() from query templates [cite: 1]. These change the query string with every execution, preventing edge and browser caches from reusing results [cite: 1]. Instead, use explicit, static date-time parameters [cite: 1].
* **Standardize Query Shapes**: Keep query parameters and grouping shapes consistent across similar chart widgets [cite: 1]. This increases cache hit rates because multiple visualizations can share the same cached API response [cite: 1].

##### Server-State Orchestration Engines

Web applications often run into performance bottlenecks when they store raw API payloads directly in client-side state managers like Redux, which are intended for UI configuration [cite: 40, 41]. Client applications should instead use specialized server-state caching libraries (like SWR or TanStack Query) to handle raw API data [cite: 42, 43].

| Selection Parameter | SWR v3 | TanStack Query v5 (React Query) | Redux Toolkit (RTK) Query |
| ------ | ------ | ------ | ------ |
| **Bundle Footprint** | Extremely light (~4 KB) [cite: 40, 44]. | Standard (~13 KB) [cite: 40, 44]. | Built-in (no extra weight if using Redux) [cite: 40, 45]. |
| **API Architecture** | Minimalist; based on positional arguments [cite: 44, 46]. | Extensive; based on declarative objects [cite: 44, 46]. | Centralized; api-slice configuration models [cite: 45, 47]. |
| **TypeScript Type Inference** | Standard support [cite: 44]. | Highly advanced type resolution [cite: 44]. | Statically compiled endpoint hooks [cite: 40, 45]. |
| **Automatic Garbage Collection** | Basic query-key invalidation [cite: 48]. | Automated, customizable cache pruning [cite: 46, 49]. | Integrated slice lifecycle cleanup [cite: 45]. |
| **DevTools Support** | Dependent on third-party integrations [cite: 44]. | Official, highly visual debugging suite [cite: 40, 44]. | Integrates with Redux DevTools [cite: 47]. |

These server-state orchestration libraries rely on two key caching parameters to manage payload lifecycles [cite: 42, 49]:

* **staleTime**: The duration that retrieved data is considered fresh [cite: 42, 49]. During this window, the library serves cached data immediately and blocks redundant network requests [cite: 44, 48].
* **cacheTime** (or gcTime): The duration that unused or inactive data remains in memory [cite: 42, 49]. If a component unmounts and remounts within this window, the library instantly displays the cached data while revalidating the source API in the background [cite: 42, 44].

##### DOM Virtualization and Viewport Management

Rendering thousands of data rows or complex statistical elements directly into the DOM can saturate browser resources, causing visible scrolling lag [cite: 50, 51]. To prevent this, developers should use DOM virtualization libraries like react-window [cite: 51, 52].
DOM virtualization restricts rendering to only the items visible within the current scroll window [cite: 50, 51]. As the user scrolls, elements that exit the viewport are recycled and repopulated with new data, keeping the active DOM footprint small [cite: 50, 52].
When implementing virtualized lists, keep these practices in mind:

* **Optimize Overscan Configuration**: Set overscanCount={5} to render a small buffer of five rows above and below the visible viewport [cite: 50, 52]. This avoids flashes of empty content during fast scrolling without causing rendering lag [cite: 50, 52].
* **Ensure Precise Item Sizing**: Avoid using unpredictable, randomized heights for list items [cite: 50]. Instead, calculate exact sizes based on content lengths to prevent jumpy scrolling behavior [cite: 50].
* **Preserve Scroll Position on Transitions**: When users open detail views from a list, keep the list component mounted in the background (such as in an overlay or modal) [cite: 53]. This preserves the virtualized scroll state and avoids expensive re-renders [cite: 53].
* **Maintain WCAG Accessibility**: Because virtualization dynamically removes offscreen elements from the DOM, it can disrupt screen readers [cite: 50]. Developers should add explicit semantic properties like role="list", role="listitem", aria-setsize, and aria-posinset to virtualized rows to help assistive technologies navigate the list correctly [cite: 50].

---

#### Graphics Execution and Web Worker Parallelism

Complex charts and rendering loops can easily block the browser's main thread, causing dropped frames and laggy input responses [cite: 54, 55].

##### OffscreenCanvas and Thread-Safe Drawing

JavaScript's single-threaded architecture means that browser layout adjustments, UI interactions, and visualization scripts share the same execution thread [cite: 54, 55]. Decoupling graphics rendering from the DOM using the OffscreenCanvas API allows developers to offload drawing operations to Web Workers [cite: 54, 56, 57].
To implement this architecture, the main thread extracts rendering control from a canvas element and passes it to a background worker [cite: 57, 58]:

```js
// main.js - Browser Main Thread
const canvasElement = document.querySelector('#analytics-canvas');
const offscreenCanvas = canvasElement.transferControlToOffscreen();
const renderWorker = new Worker('canvasWorker.js');

renderWorker.postMessage({ canvas: offscreenCanvas }, [offscreenCanvas]);
```

Inside the worker thread, the script receives the canvas, initializes a graphics context, and handles all rendering operations independently of the DOM [cite: 57, 58]:

```js
// canvasWorker.js - Background Web Worker Thread
importScripts('https://cdn.jsdelivr.net/npm/chart.js');

self.onmessage = (event) => {
  const { canvas, config } = event.data;
  if (canvas) {
    const chartInstance = new Chart(canvas, config);

    // Web Workers cannot listen to window events; resize must be updated manually
    canvas.width = 600;
    canvas.height = 400;
    chartInstance.resize();
  }
};
```

This multithreaded approach keeps the UI responsive and helps maintain a smooth 60 FPS rendering rate even during complex WebGL or 2D canvas drawing tasks [cite: 54, 55, 56].

##### Thread Communication and Low-Level Buffer Management

Because postMessage transfers can be slow on large datasets, workers should make HTTP queries directly from the background thread [cite: 59]. When data must cross threads, use zero-copy structures like ArrayBuffers or SharedArrayBuffers to avoid expensive serialization costs [cite: 59].
To handle high-frequency data streams, implement a typed ring buffer over a static SharedArrayBuffer [cite: 60]. This manages data updates within a fixed memory footprint, avoiding the garbage collection overhead associated with standard array resizing [cite: 60].

```js
// Shared Memory Ring Buffer Implementation
export class TypedRingBuffer {
  constructor(sharedArrayBuffer, capacity) {
    this.buffer = new Float32Array(sharedArrayBuffer);
    this.capacity = capacity;
    this.head = 0;
    this.count = 0;
  }

  write(sampleValue) {
    this.buffer[this.head] = sampleValue;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  read() {
    if (this.count < this.capacity) {
      return this.buffer.subarray(0, this.count);
    }
    const alignedData = new Float32Array(this.capacity);
    alignedData.set(this.buffer.subarray(this.head));
    alignedData.set(this.buffer.subarray(0, this.head), this.capacity - this.head);
    return alignedData;
  }
}
```

This typed buffer keeps write operations at O(1) constant time, allowing the system to process incoming updates smoothly without freezing the UI [cite: 60].

##### Canvas Framework Performance Optimization

To maximize visualization performance in libraries like Chart.js or D3.js, developers should apply these configuration optimizations [cite: 59]:

* **Turn Off Animations**: Disable animations to ensure that updates trigger a single draw step instead of multi-frame render transitions, which drastically reduces CPU load [cite: 59].
* **Disable Bézier Curves**: Use straight-line paths (tension: 0) instead of complex interpolation curves [cite: 59]. Calculating curves is mathematically expensive, whereas straight lines render efficiently on modern GPUs [cite: 59].
* **Skip Point Rendering**: Hide individual point markers and render only the trend lines [cite: 59]. This cuts down on canvas draw operations, which is especially helpful for large datasets [cite: 59].
* **Enable Native Path2D Caching**: Use the browser's Path2D caching to reuse pre-calculated vector paths, avoiding redrawing static line structures from scratch [cite: 59].

---

#### End-to-End Observability and Context Propagation

Achieving a highly responsive statistical platform requires continuous performance tracking across the entire stack [cite: 61, 62]. Rather than relying on siloed analytics, teams should implement OpenTelemetry to build an integrated performance tracing system [cite: 61, 63, 64].
Using the standard OpenTelemetry Browser SDK, developers can configure the FetchInstrumentation package to automatically inject standard W3C traceparent headers into outgoing API requests [cite: 61, 63]:

```js
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';

registerInstrumentations({
  instrumentations: [
    new FetchInstrumentation({
      propagateTraceHeaderCorsUrls: [
        /https:\/\/api\.statisticalplatform\.com\/.*/,
      ],
    }),
  ],
});
```

This propagates trace contexts across network boundaries [cite: 61, 63]. When the API gateway and backend databases receive these headers, they link their internal execution spans to the originating client click [cite: 61, 62, 63]. This lets teams trace client-side latency spikes directly to the backend database queries responsible [cite: 61, 62].

```
Client Navigation
       | (Triggers trace context generation)
       v
Fetch API Call ---- [traceparent: 00-4bf92f3577b3...] ----> API Gateway Routing
                                                                | (Propagates Span)
                                                                v
                                                       SQL Database Query Execution
```

Using this setup, dashboards can track Core Web Vitals to monitor user experience [cite: 61, 62, 63]:

* **Largest Contentful Paint (LCP)**: Measures loading speed [cite: 61, 65]. Teams should target a P75 value under 2.5 seconds [cite: 61, 63].
* **Interaction to Next Paint (INP)**: Tracks user interaction responsiveness [cite: 61, 65]. Target P75 scores should remain under 200 ms [cite: 61, 63].
* **Cumulative Layout Shift (CLS)**: Measures visual stability [cite: 61, 65]. Dashboards should maintain CLS values below 0.1 to prevent layout shifts as asynchronous widgets load [cite: 61, 63].

---

#### Architectural Implementation Roadmap (as written in the source notebook)

To resolve latency issues on statistics-heavy websites, developers should execute this structured implementation plan:

##### Step 1: Database Migration and Storage Tier Restructuring

* Transition high-frequency historical tables to column-oriented OLAP engines [cite: 4, 5].
* Set up physical sorting keys on primary filtering columns to enable primary index pruning [cite: 7].
* Implement Continuous Aggregates or Incremental Materialized Views to shift computation overhead from read operations to write operations [cite: 12, 13].

##### Step 2: API Gateway and Network Protocol Upgrades

* Implement cursor-based keyset pagination to maintain O(log N) query performance [cite: 17, 19].
* Set up binary serialization formats (such as Protocol Buffers or MessagePack) to reduce network payload sizes [cite: 16, 23].
* Configure Brotli compression on edge networks, pre-compressing static assets during deployment [cite: 27, 28].
* Implement Server-Sent Events (SSE) for simple unidirectional data updates [cite: 30, 31].

##### Step 3: Client State Management and Render Optimization

* Transition client-side API caching to libraries like TanStack Query, setting explicit staleTime and cacheTime configurations [cite: 42, 43].
* Implement virtualized scrolling lists (using react-window) to reduce the active DOM footprint [cite: 50, 51].
* Offload canvas-based charts to background Web Workers using OffscreenCanvas [cite: 54, 57, 58].
* Manage real-time, high-frequency updates using typed ring buffers over SharedArrayBuffers to avoid main-thread UI freezes [cite: 55, 60].

> **Not this app's roadmap.** The step order above is the source notebook's own conclusion for
> a generic, server-backed statistics dashboard. [`docs/sprints/latency.md`](../sprints/latency.md)
> re-derives a step order from this app's measured baseline instead — e.g. this app has no
> server to add SSE to or OLAP database to migrate toward, and its historical FPL tables are
> nowhere near "billions of rows."

---

#### Notebook sources (56 loaded, cited above by number)

1. 10 Best Practices for AI/BI Dashboard Performance - Databricks Community, https://community.databricks.com/t5/technical-blog/the-top-10-best-practices-for-ai-bi-dashboards-performance/ba-p/156231
2. Dashboard Performance Optimization: Speed Up Your Analytics - Sigma Computing, https://www.sigmacomputing.com/blog/dashboard-performance-optimization
3. Optimize Your Database for Dashboard Performance - Preset.io, https://preset.io/blog/optimize-database-dashboard-performance/
4. Columnar Database Use Cases and Examples - The Couchbase Blog, https://www.couchbase.com/blog/columnar-database-use-cases/
5. ClickHouse vs TimescaleDB: Which to Choose for Time-Series Data - OneUptime, https://oneuptime.com/blog/post/2026-01-21-clickhouse-vs-timescaledb/view
6. ClickHouse vs TimescaleDB: Real-Time Analytics Compared (2026) - Fastero, https://fastero.com/blog/clickhouse-vs-timescaledb-real-time-analytics-compared
7. Top 10 best practices tips for ClickHouse, https://clickhouse.com/blog/10-best-practice-tips
8. Materialized Views vs Indexes vs Star-tree Index | StarTree, https://startree.ai/resources/materialized-views-vs-indexes/
9. Optimizing Query Performance for Large Datasets Powering Dashboards - Harness Blog, https://www.harness.io/blog/optimizing-query-performance-for-large-datasets-powering-dashboards
10. What is a Materialized View? - AWS, https://aws.amazon.com/what-is/materialized-view/
11. SQL performance tuning: techniques for faster, cheaper queries | Metabase Learn, https://www.metabase.com/learn/grow-your-data-skills/data-landscape/sql-performance-tuning
12. ClickStack - materialized views - ClickHouse Documentation, https://clickhouse.com/docs/clickstack/managing/materialized-views
13. Continuous Aggregates: Incremental Materialized Views for Time-Series Data | Tiger Data, https://www.tigerdata.com/learn/continuous-aggregates-timescaledb
14. TimescaleDB Continuous Aggregates: Real-Time vs Materialized-Only - DEV Community, https://dev.to/philip_mcclarence_2ef9475/timescaledb-continuous-aggregates-real-time-vs-materialized-only-4k75
15. Build a rollup with materialized views for fast time-series analytics - ClickHouse, https://clickhouse.com/docs/guides/use-cases/real-time-analytics/time-series/materialized-view-rollup
16. Binary Serialization Formats: A Technical Benchmark & Decision Guide - Medium, https://medium.com/@shekhar.manna83/binary-serialization-formats-e2703f053010
17. Cursor-Based Pagination vs Offset Pagination: Preserving User Navigation at Scale, https://keyholesoftware.com/cursor-based-pagination-vs-offset-pagination-preserving-user-navigation-at-scale/
18. Pagination in Backend Systems: Offset vs Cursor Explained - Python in Plain English, https://python.plainenglish.io/pagination-in-backend-systems-offset-vs-cursor-explained-e70b1fd49324
19. Offset vs Cursor-Based Pagination: Choosing the Best Approach - Medium, https://medium.com/@maryam-bit/offset-vs-cursor-based-pagination-choosing-the-best-approach-2e93702a118b
20. Paginating large datasets in production: Why OFFSET fails and cursors win | Sentry Blog, https://blog.sentry.io/paginating-large-datasets-in-production-why-offset-fails-and-cursors-win/
21. JSON vs MessagePack vs Protobuf in Go — Real Benchmarks - DEV Community, https://dev.to/devflex-pro/json-vs-messagepack-vs-protobuf-in-go-my-real-benchmarks-and-what-they-mean-in-production-48fh
22. .NET Serialization Smackdown: JSON vs MessagePack vs Protobuf - Nirav Patel, https://niravinfo.medium.com/net-serialization-smackdown-json-vs-messagepack-vs-protobuf-who-rules-your-bytes-e83027c22cc8
23. Redis Serialization Best Practices (JSON vs MessagePack vs Protobuf) - OneUptime, https://oneuptime.com/blog/post/2026-03-31-redis-serialization-json-messagepack-protobuf/view
24. The Hidden Cost of JSON: Real Benchmarks with Go and Other Formats - HunCoding, https://huncoding.com/go-serialization-benchmarks-en/
25. Performant Entity Serialization: BSON vs MessagePack vs JSON - Stack Overflow, https://stackoverflow.com/questions/6355497/performant-entity-serialization-bson-vs-messagepack-vs-json
26. Gzip vs. Brotli Compression for Website Speed - Oshyn, https://www.oshyn.com/blog/gzip-vs-brotli
27. CDN Compression Performance (Brotli vs Gzip), https://blog.blazingcdn.com/en-us/cdn-compression-performance-brotli-vs-gzip
28. Brotli vs. Gzip for Web Performance In Static Sites - DEV Community, https://dev.to/lovestaco/brotli-vs-gzip-for-web-performance-in-static-sites-2nhk
29. GZIP vs Brotli Compression: Which One Is Best for Web Performance in 2025? - IO River, https://www.ioriver.io/blog/gzip-vs-brotli-compression-performance
30. WebSocket vs SSE: How to choose for real-time apps - Vercel, https://vercel.com/i/websocket-vs-server-sent-events
31. Server-Sent Events vs WebSockets: Key Differences and Use Cases in 2026 - Nimble, https://www.nimbleway.com/blog/server-sent-events-vs-websockets-what-is-the-difference-2026-guide
32. WebSockets vs Server-Sent-Events vs Long-Polling vs WebRTC vs WebTransport | RxDB, https://rxdb.info/articles/websockets-sse-polling-webrtc-webtransport.html
33. WebSocket vs HTTP, SSE, MQTT, WebRTC & More (2026), https://websocket.org/comparisons/
34. WebSockets vs Server-Sent Events vs Polling: When to Use Each - Pristren Blog, https://www.pristren.com/blog/websockets-sse-polling-guide
35. WebSocket vs WebTransport: A Comprehensive Comparison - VideoSDK, https://www.videosdk.live/blog/websocket-vs-webtransport
36. FOSDEM 2026: Intro to WebTransport - the Next WebSocket?! - InfoQ, https://www.infoq.com/news/2026/03/fosdem-webtransport-vs-websocket/
37. What is WebTransport and can it replace WebSockets? - Ably Realtime, https://ably.com/blog/can-webtransport-replace-websockets
38. SSE vs WebSocket vs WebTransport: How to Choose in 2026 - Lara Mateo, https://laramateo.com/blog/sse-vs-websocket-vs-webtransport-how-to-choose-in-2026
39. websocket (http/1.1) vs http/2 vs webtransport (http/3) vs webrtc benchmarks - Reddit, https://www.reddit.com/r/webdev/comments/1vuqahe/websocket_http11_vs_http2_vs_webtransport_http3/
40. TanStack Query v5 vs SWR v3 vs RTK Query 2026 — PkgPulse Guides, https://www.pkgpulse.com/guides/tanstack-query-v5-vs-swr-v3-vs-rtk-query-data-fetching-2026
41. Redux Toolkit vs React Query: Do You Really Need Both? - DEV Community, https://dev.to/taronvardanyan/redux-toolkit-vs-react-query-do-you-really-need-both-3m9d
42. SWR vs React-Query - DEV Community, https://dev.to/leticiabytes/swr-vs-react-query-5el0
43. React Query vs. SWR vs. Redux Toolkit Query: Choosing the Right Tool - ResearchGate, https://www.researchgate.net/publication/394407975_React_Query_vs_SWR_vs_Redux_Toolkit_Query_Choosing_the_Right_Tool_for_Your_Project
44. React Query vs TanStack Query vs SWR: A 2025 Comparison - Refine, https://refine.dev/blog/react-query-vs-tanstack-query-vs-swr-2025/
45. RTK Query vs React Query - Reza Daliri, https://daliri.ca/blog/tech/2025-01-29-rtkquery-vs-reactquery/
46. SWR vs React Query: The Ultimate Guide to Data Fetching in React Applications - Medium, https://medium.com/@siddharthpatil9108/swr-vs-react-query-the-ultimate-guide-to-data-fetching-in-react-applications-7a8d6e5d737f
47. React Query vs RTK Query: A Comparative Guide for Data Fetching in React - Mediusware, https://mediusware.com/blog/react-query-vs-rtk-query-a-comparative-guide-for-d
48. React Query vs SWR: Which One is Better? - NamasteDev Blogs, https://namastedev.com/blog/react-query-vs-swr-which-one-is-better/
49. React Query : staleTime vs cacheTime - DEV Community, https://dev.to/delisrey/react-query-staletime-vs-cachetime-hml
50. Windowing and Virtualization | React Performance - Steve Kinney, https://stevekinney.com/courses/react-performance/windowing-and-virtualization
51. Virtual Scrolling in React - Swatik Paul, Medium, https://medium.com/@swatikpl44/virtual-scrolling-in-react-6028f700da6b
52. Virtualize large lists with react-window | Articles - web.dev, https://web.dev/articles/virtualize-long-lists-react-window
53. Building High-Performance Scroll Restoration Infinite Lists on the Web - Jeremy, https://javascript.plainenglish.io/building-high-performance-scroll-restoration-infinite-lists-on-the-web-baa55d4cd52f
54. OffscreenCanvas — speed up your canvas operations with a web worker | Articles, https://web.dev/articles/offscreen-canvas
55. Thread-Safe Canvas: Building Zero-Latency Interfaces with Web Workers - Perumal Palani, https://perumalpalani.com/tech/thread-safe-canvas-web-workers/
56. Enhancing Graphics Performance with OffscreenCanvas and D3.js - DEV Community, https://dev.to/jeevankishore/enhancing-graphics-performance-with-offscreencanvas-and-d3js-19ka
57. OffscreenCanvas - Web APIs | MDN, https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas
58. Rendering charts with OffscreenCanvas - Scott Logic Blog, https://blog.scottlogic.com/2020/03/19/offscreen-canvas.html
59. Performance | Chart.js, https://www.chartjs.org/docs/latest/general/performance.html
60. High-Frequency Real-Time Data in React: From Ring Buffers to OffscreenCanvas, https://www.freecodecamp.org/news/high-frequency-real-time-data-in-react-from-ring-buffers-to-offscreencanvas/
61. What Is Frontend Monitoring? - Dash0, https://www.dash0.com/knowledge/what-is-frontend-monitoring
62. Website Monitoring Guide: Real User Monitoring with OpenTelemetry and Dash0, https://www.dash0.com/guides/website-monitoring-with-opentelemetry-and-dash0
63. How to Create a Frontend Performance Dashboard with Core Web Vitals - OneUptime, https://oneuptime.com/blog/post/2026-02-06-frontend-performance-dashboard-core-web-vitals-opentelemetry/view
64. Real user monitoring (rum) - Sumo Logic, https://www.sumologic.com/solutions/real-user-monitoring
65. Monitor Core Web Vitals with Datadog RUM and Synthetic Monitoring, https://www.datadoghq.com/blog/core-web-vitals-monitoring-datadog-rum-synthetics/

Additionally loaded but not cited by the synthesis above:

66. websocket (http/1.1) vs http/2 vs webtransport (http/3) vs webrtc benchmarks - Reddit, https://www.reddit.com/r/webdev/comments/1vuqahe/websocket_http11_vs_http2_vs_webtransport_http3/

#### Sources the notebook failed to load (status: error — no content available)

* https://javascript.plainenglish.io/building-high-performance-scroll-restoration-infinite-lists-on-the-web-baa55d4cd52f (also listed above as #53 — the notebook recorded two entries for this URL, one `ready` and one `error`)
* https://medium.com/@maryam-bit/offset-vs-cursor-based-pagination-choosing-the-best-approach-2e93702a118b
* https://medium.com/@shekhar.manna83/binary-serialization-formats-e2703f053010
* https://medium.com/@siddharthpatil9108/swr-vs-react-query-the-ultimate-guide-to-data-fetching-in-react-applications-7a8d6e5d737f
* https://medium.com/@swatikpl44/virtual-scrolling-in-react-6028f700da6b
* https://namastedev.com/blog/react-query-vs-swr-which-one-is-better/
* https://niravinfo.medium.com/net-serialization-smackdown-json-vs-messagepack-vs-protobuf-who-rules-your-bytes-e83027c22cc8
* https://python.plainenglish.io/pagination-in-backend-systems-offset-vs-cursor-explained-e70b1fd49324
* https://stackoverflow.com/questions/6355497/performant-entity-serialization-bson-vs-messagepack-vs-json
* https://www.pristren.com/blog/websockets-sse-polling-guide
* https://www.researchgate.net/publication/394407975_React_Query_vs_SWR_vs_Redux_Toolkit_Query_Choosing_the_Right_Tool_for_Your_Project

(Duplicate URLs above between the "ready" citation list and the "error" list reflect the
notebook's own state at export time — a source was added twice and one copy failed to fetch.
The synthesis document's citations still resolve because the successfully-loaded copy backs
each numbered reference.)
