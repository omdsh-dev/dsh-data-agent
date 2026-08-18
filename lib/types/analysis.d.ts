/**
 * Shared version-1 analysis report contract, used by BOTH package halves:
 * the Node tool half (render-analysis) validates and builds reports with it,
 * and the Web client decodes persisted tool/result.meta with it. The module
 * is pure TypeScript (no node: imports, no DOM) so it bundles into the client
 * unchanged.
 *
 * The strict parser rejects unknown properties, duplicate ids, dangling
 * dataset references, count violations and every disallowed view shape, so a
 * model can never smuggle arbitrary chart-library options, HTML, CSS or URLs
 * through the wire contract.
 * @module @yejiming/dsh-data-agent/analysis
 */
/** Wire version stamped onto every request/report. */
export declare const ANALYSIS_REPORT_VERSION: 1;
/** Dataset count bounds for one report (D1). */
export declare const MAX_ANALYSIS_DATASETS = 6;
export declare const MIN_ANALYSIS_DATASETS = 1;
/** View count bounds for one report (D1). */
export declare const MAX_ANALYSIS_VIEWS = 8;
export declare const MIN_ANALYSIS_VIEWS = 1;
/** Series bounds for one line/bar view (D2). */
export declare const MIN_ANALYSIS_SERIES = 1;
export declare const MAX_ANALYSIS_SERIES = 4;
/** Total JSON-encoded report size bound (D4): 512 KiB. */
export declare const MAX_REPORT_BYTES: number;
/** The six discriminated view kinds. */
export type AnalysisViewKind = 'metric' | 'line' | 'bar' | 'pie' | 'scatter' | 'table';
/** Grid width of one non-metric view. */
export type AnalysisViewWidth = 'full' | 'half';
/** line/bar x axis semantics. */
export type AnalysisAxisType = 'category' | 'time';
/** Supported metric number format. */
export type AnalysisMetricFormat = 'number' | 'percent';
/** Fields shared by every view. */
interface AnalysisViewBaseV1 {
    id: string;
    kind: AnalysisViewKind;
    datasetId: string;
    label?: string;
}
/** Fields shared by the non-metric views. */
interface AnalysisGridBaseV1 extends AnalysisViewBaseV1 {
    width?: AnalysisViewWidth;
}
/** One metric view: a single finite number with a label. */
export interface AnalysisMetricViewV1 extends AnalysisViewBaseV1 {
    kind: 'metric';
    field: string;
    label: string;
    format?: AnalysisMetricFormat;
}
/** One line/bar view over a shared x axis and 1-4 y fields (or one seriesField). */
export interface AnalysisLineBarViewV1 extends AnalysisGridBaseV1 {
    kind: 'line' | 'bar';
    x: {
        field: string;
        type: AnalysisAxisType;
        label?: string;
    };
    y: string[];
    seriesField?: string;
}
/** One pie view (category + non-negative value). */
export interface AnalysisPieViewV1 extends AnalysisGridBaseV1 {
    kind: 'pie';
    categoryField: string;
    valueField: string;
}
/** One scatter view (x/y numeric pairs). */
export interface AnalysisScatterViewV1 extends AnalysisGridBaseV1 {
    kind: 'scatter';
    xField: string;
    yField: string;
}
/** One semantic table view with an optional column whitelist. */
export interface AnalysisTableViewV1 extends AnalysisGridBaseV1 {
    kind: 'table';
    columns?: string[];
}
export type AnalysisViewV1 = AnalysisMetricViewV1 | AnalysisLineBarViewV1 | AnalysisPieViewV1 | AnalysisScatterViewV1 | AnalysisTableViewV1;
/** One request dataset: a unique id plus one read-only SQL statement. */
export interface AnalysisDatasetRequestV1 {
    id: string;
    sql: string;
}
/** The wire request accepted by the render-analysis tool. */
export interface AnalysisRequestV1 {
    title: string;
    /** Semantic output basename; directory is always analysis-reports/. */
    outputName?: string;
    summary?: string;
    datasets: AnalysisDatasetRequestV1[];
    views: AnalysisViewV1[];
}
/** One normalized dataset inside a report: aligned two-dimensional rows. */
export interface AnalysisDatasetResultV1 {
    id: string;
    columns: string[];
    rows: (string | null)[][];
}
/** The canonical version-1 report persisted into presentationMeta. */
export interface AnalysisReportV1 {
    version: typeof ANALYSIS_REPORT_VERSION;
    title: string;
    summary?: string;
    /** Absolute path of the generated HTML artifact (absent on legacy v1 meta). */
    htmlPath?: string;
    datasets: AnalysisDatasetResultV1[];
    views: AnalysisViewV1[];
}
/** Dataset rows in object form (the sql-query canonical shape). */
export interface DatasetRows {
    columns: string[];
    rows: Record<string, string | null>[];
}
/** Whether a view kind is one of the four chart kinds. */
export declare function isChartKind(kind: AnalysisViewKind): boolean;
/**
 * Strictly parse a model-supplied analysis request. Every structural
 * violation (unknown fields, duplicate ids, dangling references, count or
 * union constraints) throws with a message naming the offending view/dataset.
 */
export declare function parseAnalysisRequest(input: unknown, prefix?: string): AnalysisRequestV1;
/** Strictly parse a persisted report meta; throws on any shape violation. */
export declare function parseAnalysisReport(input: unknown, prefix?: string): AnalysisReportV1;
/** Whether one string parses to a finite number. */
export declare function isFiniteNumberText(value: string): boolean;
/** Whether one string parses as a time value. */
export declare function isParseableTimeText(value: string): boolean;
/**
 * Validate view→dataset semantics AFTER all queries succeeded and BEFORE any
 * meta is built: field existence, finite numerics, pie non-negativity, time
 * parseability, and table whitelist existence. The client is never asked to
 * aggregate, sort, or treat null as zero — validation happens here.
 */
export declare function validateViewSemantics(views: readonly AnalysisViewV1[], datasets: ReadonlyMap<string, DatasetRows>, prefix?: string): void;
/** Compress object rows into column-aligned two-dimensional arrays (D2). */
export declare function rowsToArrays(columns: string[], rows: readonly Record<string, string | null>[]): (string | null)[][];
/** JSON-encoded UTF-8 size of the normalized report (the 512 KiB bound). */
export declare function reportJsonBytes(report: AnalysisReportV1): number;
/** One-line model-facing summary; never re-injects rows into model context (D5). */
export declare function formatAnalysisSummary(report: Pick<AnalysisReportV1, 'title' | 'datasets' | 'views' | 'htmlPath'>): string;
/** The view union: exactly the six supported kinds, nothing else. */
export declare const ANALYSIS_VIEWS_SCHEMA: {
    readonly oneOf: readonly [{
        readonly type: "object";
        readonly properties: {
            readonly id: {
                readonly type: "string";
                readonly required: true;
                readonly description: "视图唯一 id（本报告内不重复）";
            };
            readonly kind: {
                readonly type: "string";
                readonly const: "metric";
                readonly required: true;
            };
            readonly datasetId: {
                readonly type: "string";
                readonly required: true;
                readonly description: "引用本次请求中的一个 dataset id";
            };
            readonly field: {
                readonly type: "string";
                readonly required: true;
                readonly description: "数值字段名（来自 dataset 查询结果的列）";
            };
            readonly label: {
                readonly type: "string";
                readonly required: true;
                readonly description: "指标名称，如「本月营收」";
            };
            readonly format: {
                readonly type: "string";
                readonly enum: readonly ["number", "percent"];
                readonly description: "可选数值格式：number（默认）或 percent（值×100 后加 %）";
            };
        };
        readonly additionalProperties: false;
    }, {
        readonly type: "object";
        readonly properties: {
            readonly id: {
                readonly type: "string";
                readonly required: true;
                readonly description: "视图唯一 id（本报告内不重复）";
            };
            readonly kind: {
                readonly type: "string";
                readonly const: "line" | "bar";
                readonly required: true;
            };
            readonly datasetId: {
                readonly type: "string";
                readonly required: true;
                readonly description: "引用本次请求中的一个 dataset id";
            };
            readonly label: {
                readonly type: "string";
                readonly description: "可选视图标题，用于图表可访问名称与空态";
            };
            readonly width: {
                readonly type: "string";
                readonly enum: readonly ["full", "half"];
                readonly description: "可选宽度：full 整行 / half 半行（缺省由系统决定）";
            };
            readonly x: {
                readonly type: "object";
                readonly properties: {
                    readonly field: {
                        readonly type: "string";
                        readonly required: true;
                        readonly description: "x 轴字段名";
                    };
                    readonly type: {
                        readonly type: "string";
                        readonly enum: readonly ["category", "time"];
                        readonly required: true;
                        readonly description: "category 分类轴 / time 时间轴（数据需可由 Date 解析，SQL 请 ORDER BY）";
                    };
                    readonly label: {
                        readonly type: "string";
                        readonly description: "可选 x 轴名称";
                    };
                };
                readonly additionalProperties: false;
                readonly required: true;
            };
            readonly y: {
                readonly type: "array";
                readonly required: true;
                readonly items: {
                    readonly type: "string";
                };
                readonly description: "1-4 个数值 y 字段名；声明多个 y 时不得同时声明 seriesField";
            };
            readonly seriesField: {
                readonly type: "string";
                readonly description: "可选分组字段：按该字段取值拆成多个系列（与多个 y 字段互斥）";
            };
        };
        readonly additionalProperties: false;
    }, {
        readonly type: "object";
        readonly properties: {
            readonly id: {
                readonly type: "string";
                readonly required: true;
                readonly description: "视图唯一 id（本报告内不重复）";
            };
            readonly kind: {
                readonly type: "string";
                readonly const: "line" | "bar";
                readonly required: true;
            };
            readonly datasetId: {
                readonly type: "string";
                readonly required: true;
                readonly description: "引用本次请求中的一个 dataset id";
            };
            readonly label: {
                readonly type: "string";
                readonly description: "可选视图标题，用于图表可访问名称与空态";
            };
            readonly width: {
                readonly type: "string";
                readonly enum: readonly ["full", "half"];
                readonly description: "可选宽度：full 整行 / half 半行（缺省由系统决定）";
            };
            readonly x: {
                readonly type: "object";
                readonly properties: {
                    readonly field: {
                        readonly type: "string";
                        readonly required: true;
                        readonly description: "x 轴字段名";
                    };
                    readonly type: {
                        readonly type: "string";
                        readonly enum: readonly ["category", "time"];
                        readonly required: true;
                        readonly description: "category 分类轴 / time 时间轴（数据需可由 Date 解析，SQL 请 ORDER BY）";
                    };
                    readonly label: {
                        readonly type: "string";
                        readonly description: "可选 x 轴名称";
                    };
                };
                readonly additionalProperties: false;
                readonly required: true;
            };
            readonly y: {
                readonly type: "array";
                readonly required: true;
                readonly items: {
                    readonly type: "string";
                };
                readonly description: "1-4 个数值 y 字段名；声明多个 y 时不得同时声明 seriesField";
            };
            readonly seriesField: {
                readonly type: "string";
                readonly description: "可选分组字段：按该字段取值拆成多个系列（与多个 y 字段互斥）";
            };
        };
        readonly additionalProperties: false;
    }, {
        readonly type: "object";
        readonly properties: {
            readonly id: {
                readonly type: "string";
                readonly required: true;
                readonly description: "视图唯一 id（本报告内不重复）";
            };
            readonly kind: {
                readonly type: "string";
                readonly const: "pie";
                readonly required: true;
            };
            readonly datasetId: {
                readonly type: "string";
                readonly required: true;
                readonly description: "引用本次请求中的一个 dataset id";
            };
            readonly label: {
                readonly type: "string";
                readonly description: "可选视图标题，用于图表可访问名称与空态";
            };
            readonly width: {
                readonly type: "string";
                readonly enum: readonly ["full", "half"];
                readonly description: "可选宽度：full 整行 / half 半行（缺省由系统决定）";
            };
            readonly categoryField: {
                readonly type: "string";
                readonly required: true;
                readonly description: "分类字段名";
            };
            readonly valueField: {
                readonly type: "string";
                readonly required: true;
                readonly description: "非负数值字段名";
            };
        };
        readonly additionalProperties: false;
    }, {
        readonly type: "object";
        readonly properties: {
            readonly id: {
                readonly type: "string";
                readonly required: true;
                readonly description: "视图唯一 id（本报告内不重复）";
            };
            readonly kind: {
                readonly type: "string";
                readonly const: "scatter";
                readonly required: true;
            };
            readonly datasetId: {
                readonly type: "string";
                readonly required: true;
                readonly description: "引用本次请求中的一个 dataset id";
            };
            readonly label: {
                readonly type: "string";
                readonly description: "可选视图标题，用于图表可访问名称与空态";
            };
            readonly width: {
                readonly type: "string";
                readonly enum: readonly ["full", "half"];
                readonly description: "可选宽度：full 整行 / half 半行（缺省由系统决定）";
            };
            readonly xField: {
                readonly type: "string";
                readonly required: true;
                readonly description: "数值 x 字段名";
            };
            readonly yField: {
                readonly type: "string";
                readonly required: true;
                readonly description: "数值 y 字段名";
            };
        };
        readonly additionalProperties: false;
    }, {
        readonly type: "object";
        readonly properties: {
            readonly id: {
                readonly type: "string";
                readonly required: true;
                readonly description: "视图唯一 id（本报告内不重复）";
            };
            readonly kind: {
                readonly type: "string";
                readonly const: "table";
                readonly required: true;
            };
            readonly datasetId: {
                readonly type: "string";
                readonly required: true;
                readonly description: "引用本次请求中的一个 dataset id";
            };
            readonly label: {
                readonly type: "string";
                readonly description: "可选视图标题，用于图表可访问名称与空态";
            };
            readonly width: {
                readonly type: "string";
                readonly enum: readonly ["full", "half"];
                readonly description: "可选宽度：full 整行 / half 半行（缺省由系统决定）";
            };
            readonly columns: {
                readonly type: "array";
                readonly items: {
                    readonly type: "string";
                };
                readonly description: "可选列白名单；省略时按 dataset 列顺序显示";
            };
        };
        readonly additionalProperties: false;
    }];
};
/** Wire parameter schema of the render-analysis tool. */
export declare const RENDER_ANALYSIS_PARAMETERS: {
    readonly title: {
        readonly type: "string";
        readonly required: true;
        readonly description: "报告标题，如「月度经营分析」";
    };
    readonly outputName: {
        readonly type: "string";
        readonly description: "可选语义化HTML文件名（仅basename，可省略.html），如「电商经营全景分析-2023-09至2026-08」；缺省时使用title，不要使用随机ID";
    };
    readonly summary: {
        readonly type: "string";
        readonly description: "可选一句话结论/摘要，显示在报告头部";
    };
    readonly datasets: {
        readonly type: "array";
        readonly required: true;
        readonly items: {
            readonly type: "object";
            readonly properties: {
                readonly id: {
                    readonly type: "string";
                    readonly required: true;
                    readonly description: "数据集唯一 id（供 views 引用）";
                };
                readonly sql: {
                    readonly type: "string";
                    readonly required: true;
                    readonly description: "一条只读 SQL（SELECT/SHOW/DESCRIBE/EXPLAIN；聚合、Top N、排序都写在 SQL 中）";
                };
            };
            readonly additionalProperties: false;
        };
        readonly description: "1-6 个数据集；每个按顺序恰好执行一次，同一数据集可被多个视图复用";
    };
    readonly views: {
        readonly type: "array";
        readonly required: true;
        readonly items: {
            readonly oneOf: readonly [{
                readonly type: "object";
                readonly properties: {
                    readonly id: {
                        readonly type: "string";
                        readonly required: true;
                        readonly description: "视图唯一 id（本报告内不重复）";
                    };
                    readonly kind: {
                        readonly type: "string";
                        readonly const: "metric";
                        readonly required: true;
                    };
                    readonly datasetId: {
                        readonly type: "string";
                        readonly required: true;
                        readonly description: "引用本次请求中的一个 dataset id";
                    };
                    readonly field: {
                        readonly type: "string";
                        readonly required: true;
                        readonly description: "数值字段名（来自 dataset 查询结果的列）";
                    };
                    readonly label: {
                        readonly type: "string";
                        readonly required: true;
                        readonly description: "指标名称，如「本月营收」";
                    };
                    readonly format: {
                        readonly type: "string";
                        readonly enum: readonly ["number", "percent"];
                        readonly description: "可选数值格式：number（默认）或 percent（值×100 后加 %）";
                    };
                };
                readonly additionalProperties: false;
            }, {
                readonly type: "object";
                readonly properties: {
                    readonly id: {
                        readonly type: "string";
                        readonly required: true;
                        readonly description: "视图唯一 id（本报告内不重复）";
                    };
                    readonly kind: {
                        readonly type: "string";
                        readonly const: "line" | "bar";
                        readonly required: true;
                    };
                    readonly datasetId: {
                        readonly type: "string";
                        readonly required: true;
                        readonly description: "引用本次请求中的一个 dataset id";
                    };
                    readonly label: {
                        readonly type: "string";
                        readonly description: "可选视图标题，用于图表可访问名称与空态";
                    };
                    readonly width: {
                        readonly type: "string";
                        readonly enum: readonly ["full", "half"];
                        readonly description: "可选宽度：full 整行 / half 半行（缺省由系统决定）";
                    };
                    readonly x: {
                        readonly type: "object";
                        readonly properties: {
                            readonly field: {
                                readonly type: "string";
                                readonly required: true;
                                readonly description: "x 轴字段名";
                            };
                            readonly type: {
                                readonly type: "string";
                                readonly enum: readonly ["category", "time"];
                                readonly required: true;
                                readonly description: "category 分类轴 / time 时间轴（数据需可由 Date 解析，SQL 请 ORDER BY）";
                            };
                            readonly label: {
                                readonly type: "string";
                                readonly description: "可选 x 轴名称";
                            };
                        };
                        readonly additionalProperties: false;
                        readonly required: true;
                    };
                    readonly y: {
                        readonly type: "array";
                        readonly required: true;
                        readonly items: {
                            readonly type: "string";
                        };
                        readonly description: "1-4 个数值 y 字段名；声明多个 y 时不得同时声明 seriesField";
                    };
                    readonly seriesField: {
                        readonly type: "string";
                        readonly description: "可选分组字段：按该字段取值拆成多个系列（与多个 y 字段互斥）";
                    };
                };
                readonly additionalProperties: false;
            }, {
                readonly type: "object";
                readonly properties: {
                    readonly id: {
                        readonly type: "string";
                        readonly required: true;
                        readonly description: "视图唯一 id（本报告内不重复）";
                    };
                    readonly kind: {
                        readonly type: "string";
                        readonly const: "line" | "bar";
                        readonly required: true;
                    };
                    readonly datasetId: {
                        readonly type: "string";
                        readonly required: true;
                        readonly description: "引用本次请求中的一个 dataset id";
                    };
                    readonly label: {
                        readonly type: "string";
                        readonly description: "可选视图标题，用于图表可访问名称与空态";
                    };
                    readonly width: {
                        readonly type: "string";
                        readonly enum: readonly ["full", "half"];
                        readonly description: "可选宽度：full 整行 / half 半行（缺省由系统决定）";
                    };
                    readonly x: {
                        readonly type: "object";
                        readonly properties: {
                            readonly field: {
                                readonly type: "string";
                                readonly required: true;
                                readonly description: "x 轴字段名";
                            };
                            readonly type: {
                                readonly type: "string";
                                readonly enum: readonly ["category", "time"];
                                readonly required: true;
                                readonly description: "category 分类轴 / time 时间轴（数据需可由 Date 解析，SQL 请 ORDER BY）";
                            };
                            readonly label: {
                                readonly type: "string";
                                readonly description: "可选 x 轴名称";
                            };
                        };
                        readonly additionalProperties: false;
                        readonly required: true;
                    };
                    readonly y: {
                        readonly type: "array";
                        readonly required: true;
                        readonly items: {
                            readonly type: "string";
                        };
                        readonly description: "1-4 个数值 y 字段名；声明多个 y 时不得同时声明 seriesField";
                    };
                    readonly seriesField: {
                        readonly type: "string";
                        readonly description: "可选分组字段：按该字段取值拆成多个系列（与多个 y 字段互斥）";
                    };
                };
                readonly additionalProperties: false;
            }, {
                readonly type: "object";
                readonly properties: {
                    readonly id: {
                        readonly type: "string";
                        readonly required: true;
                        readonly description: "视图唯一 id（本报告内不重复）";
                    };
                    readonly kind: {
                        readonly type: "string";
                        readonly const: "pie";
                        readonly required: true;
                    };
                    readonly datasetId: {
                        readonly type: "string";
                        readonly required: true;
                        readonly description: "引用本次请求中的一个 dataset id";
                    };
                    readonly label: {
                        readonly type: "string";
                        readonly description: "可选视图标题，用于图表可访问名称与空态";
                    };
                    readonly width: {
                        readonly type: "string";
                        readonly enum: readonly ["full", "half"];
                        readonly description: "可选宽度：full 整行 / half 半行（缺省由系统决定）";
                    };
                    readonly categoryField: {
                        readonly type: "string";
                        readonly required: true;
                        readonly description: "分类字段名";
                    };
                    readonly valueField: {
                        readonly type: "string";
                        readonly required: true;
                        readonly description: "非负数值字段名";
                    };
                };
                readonly additionalProperties: false;
            }, {
                readonly type: "object";
                readonly properties: {
                    readonly id: {
                        readonly type: "string";
                        readonly required: true;
                        readonly description: "视图唯一 id（本报告内不重复）";
                    };
                    readonly kind: {
                        readonly type: "string";
                        readonly const: "scatter";
                        readonly required: true;
                    };
                    readonly datasetId: {
                        readonly type: "string";
                        readonly required: true;
                        readonly description: "引用本次请求中的一个 dataset id";
                    };
                    readonly label: {
                        readonly type: "string";
                        readonly description: "可选视图标题，用于图表可访问名称与空态";
                    };
                    readonly width: {
                        readonly type: "string";
                        readonly enum: readonly ["full", "half"];
                        readonly description: "可选宽度：full 整行 / half 半行（缺省由系统决定）";
                    };
                    readonly xField: {
                        readonly type: "string";
                        readonly required: true;
                        readonly description: "数值 x 字段名";
                    };
                    readonly yField: {
                        readonly type: "string";
                        readonly required: true;
                        readonly description: "数值 y 字段名";
                    };
                };
                readonly additionalProperties: false;
            }, {
                readonly type: "object";
                readonly properties: {
                    readonly id: {
                        readonly type: "string";
                        readonly required: true;
                        readonly description: "视图唯一 id（本报告内不重复）";
                    };
                    readonly kind: {
                        readonly type: "string";
                        readonly const: "table";
                        readonly required: true;
                    };
                    readonly datasetId: {
                        readonly type: "string";
                        readonly required: true;
                        readonly description: "引用本次请求中的一个 dataset id";
                    };
                    readonly label: {
                        readonly type: "string";
                        readonly description: "可选视图标题，用于图表可访问名称与空态";
                    };
                    readonly width: {
                        readonly type: "string";
                        readonly enum: readonly ["full", "half"];
                        readonly description: "可选宽度：full 整行 / half 半行（缺省由系统决定）";
                    };
                    readonly columns: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                        readonly description: "可选列白名单；省略时按 dataset 列顺序显示";
                    };
                };
                readonly additionalProperties: false;
            }];
        };
        readonly description: "1-8 个视图；每个视图必须回答一个不同子问题，多个视图可共享同一 dataset";
    };
};
/** Canonical output schema of the render-analysis tool. */
export declare const ANALYSIS_REPORT_OUTPUT_SCHEMA: {
    readonly type: "object";
    readonly properties: {
        readonly version: {
            readonly type: "integer";
            readonly const: 1;
            readonly required: true;
        };
        readonly title: {
            readonly type: "string";
            readonly required: true;
        };
        readonly summary: {
            readonly type: "string";
        };
        readonly htmlPath: {
            readonly type: "string";
            readonly required: true;
        };
        readonly datasets: {
            readonly type: "array";
            readonly required: true;
            readonly items: {
                readonly type: "object";
                readonly properties: {
                    readonly id: {
                        readonly type: "string";
                        readonly required: true;
                    };
                    readonly columns: {
                        readonly type: "array";
                        readonly required: true;
                        readonly items: {
                            readonly type: "string";
                        };
                    };
                    readonly rows: {
                        readonly type: "array";
                        readonly required: true;
                        readonly items: {
                            readonly type: "array";
                            readonly items: {
                                readonly oneOf: readonly [{
                                    readonly type: "string";
                                }, {
                                    readonly type: "null";
                                }];
                            };
                        };
                    };
                };
                readonly additionalProperties: false;
            };
        };
        readonly views: {
            readonly type: "array";
            readonly required: true;
            readonly items: {
                readonly oneOf: readonly [{
                    readonly type: "object";
                    readonly properties: {
                        readonly id: {
                            readonly type: "string";
                            readonly required: true;
                            readonly description: "视图唯一 id（本报告内不重复）";
                        };
                        readonly kind: {
                            readonly type: "string";
                            readonly const: "metric";
                            readonly required: true;
                        };
                        readonly datasetId: {
                            readonly type: "string";
                            readonly required: true;
                            readonly description: "引用本次请求中的一个 dataset id";
                        };
                        readonly field: {
                            readonly type: "string";
                            readonly required: true;
                            readonly description: "数值字段名（来自 dataset 查询结果的列）";
                        };
                        readonly label: {
                            readonly type: "string";
                            readonly required: true;
                            readonly description: "指标名称，如「本月营收」";
                        };
                        readonly format: {
                            readonly type: "string";
                            readonly enum: readonly ["number", "percent"];
                            readonly description: "可选数值格式：number（默认）或 percent（值×100 后加 %）";
                        };
                    };
                    readonly additionalProperties: false;
                }, {
                    readonly type: "object";
                    readonly properties: {
                        readonly id: {
                            readonly type: "string";
                            readonly required: true;
                            readonly description: "视图唯一 id（本报告内不重复）";
                        };
                        readonly kind: {
                            readonly type: "string";
                            readonly const: "line" | "bar";
                            readonly required: true;
                        };
                        readonly datasetId: {
                            readonly type: "string";
                            readonly required: true;
                            readonly description: "引用本次请求中的一个 dataset id";
                        };
                        readonly label: {
                            readonly type: "string";
                            readonly description: "可选视图标题，用于图表可访问名称与空态";
                        };
                        readonly width: {
                            readonly type: "string";
                            readonly enum: readonly ["full", "half"];
                            readonly description: "可选宽度：full 整行 / half 半行（缺省由系统决定）";
                        };
                        readonly x: {
                            readonly type: "object";
                            readonly properties: {
                                readonly field: {
                                    readonly type: "string";
                                    readonly required: true;
                                    readonly description: "x 轴字段名";
                                };
                                readonly type: {
                                    readonly type: "string";
                                    readonly enum: readonly ["category", "time"];
                                    readonly required: true;
                                    readonly description: "category 分类轴 / time 时间轴（数据需可由 Date 解析，SQL 请 ORDER BY）";
                                };
                                readonly label: {
                                    readonly type: "string";
                                    readonly description: "可选 x 轴名称";
                                };
                            };
                            readonly additionalProperties: false;
                            readonly required: true;
                        };
                        readonly y: {
                            readonly type: "array";
                            readonly required: true;
                            readonly items: {
                                readonly type: "string";
                            };
                            readonly description: "1-4 个数值 y 字段名；声明多个 y 时不得同时声明 seriesField";
                        };
                        readonly seriesField: {
                            readonly type: "string";
                            readonly description: "可选分组字段：按该字段取值拆成多个系列（与多个 y 字段互斥）";
                        };
                    };
                    readonly additionalProperties: false;
                }, {
                    readonly type: "object";
                    readonly properties: {
                        readonly id: {
                            readonly type: "string";
                            readonly required: true;
                            readonly description: "视图唯一 id（本报告内不重复）";
                        };
                        readonly kind: {
                            readonly type: "string";
                            readonly const: "line" | "bar";
                            readonly required: true;
                        };
                        readonly datasetId: {
                            readonly type: "string";
                            readonly required: true;
                            readonly description: "引用本次请求中的一个 dataset id";
                        };
                        readonly label: {
                            readonly type: "string";
                            readonly description: "可选视图标题，用于图表可访问名称与空态";
                        };
                        readonly width: {
                            readonly type: "string";
                            readonly enum: readonly ["full", "half"];
                            readonly description: "可选宽度：full 整行 / half 半行（缺省由系统决定）";
                        };
                        readonly x: {
                            readonly type: "object";
                            readonly properties: {
                                readonly field: {
                                    readonly type: "string";
                                    readonly required: true;
                                    readonly description: "x 轴字段名";
                                };
                                readonly type: {
                                    readonly type: "string";
                                    readonly enum: readonly ["category", "time"];
                                    readonly required: true;
                                    readonly description: "category 分类轴 / time 时间轴（数据需可由 Date 解析，SQL 请 ORDER BY）";
                                };
                                readonly label: {
                                    readonly type: "string";
                                    readonly description: "可选 x 轴名称";
                                };
                            };
                            readonly additionalProperties: false;
                            readonly required: true;
                        };
                        readonly y: {
                            readonly type: "array";
                            readonly required: true;
                            readonly items: {
                                readonly type: "string";
                            };
                            readonly description: "1-4 个数值 y 字段名；声明多个 y 时不得同时声明 seriesField";
                        };
                        readonly seriesField: {
                            readonly type: "string";
                            readonly description: "可选分组字段：按该字段取值拆成多个系列（与多个 y 字段互斥）";
                        };
                    };
                    readonly additionalProperties: false;
                }, {
                    readonly type: "object";
                    readonly properties: {
                        readonly id: {
                            readonly type: "string";
                            readonly required: true;
                            readonly description: "视图唯一 id（本报告内不重复）";
                        };
                        readonly kind: {
                            readonly type: "string";
                            readonly const: "pie";
                            readonly required: true;
                        };
                        readonly datasetId: {
                            readonly type: "string";
                            readonly required: true;
                            readonly description: "引用本次请求中的一个 dataset id";
                        };
                        readonly label: {
                            readonly type: "string";
                            readonly description: "可选视图标题，用于图表可访问名称与空态";
                        };
                        readonly width: {
                            readonly type: "string";
                            readonly enum: readonly ["full", "half"];
                            readonly description: "可选宽度：full 整行 / half 半行（缺省由系统决定）";
                        };
                        readonly categoryField: {
                            readonly type: "string";
                            readonly required: true;
                            readonly description: "分类字段名";
                        };
                        readonly valueField: {
                            readonly type: "string";
                            readonly required: true;
                            readonly description: "非负数值字段名";
                        };
                    };
                    readonly additionalProperties: false;
                }, {
                    readonly type: "object";
                    readonly properties: {
                        readonly id: {
                            readonly type: "string";
                            readonly required: true;
                            readonly description: "视图唯一 id（本报告内不重复）";
                        };
                        readonly kind: {
                            readonly type: "string";
                            readonly const: "scatter";
                            readonly required: true;
                        };
                        readonly datasetId: {
                            readonly type: "string";
                            readonly required: true;
                            readonly description: "引用本次请求中的一个 dataset id";
                        };
                        readonly label: {
                            readonly type: "string";
                            readonly description: "可选视图标题，用于图表可访问名称与空态";
                        };
                        readonly width: {
                            readonly type: "string";
                            readonly enum: readonly ["full", "half"];
                            readonly description: "可选宽度：full 整行 / half 半行（缺省由系统决定）";
                        };
                        readonly xField: {
                            readonly type: "string";
                            readonly required: true;
                            readonly description: "数值 x 字段名";
                        };
                        readonly yField: {
                            readonly type: "string";
                            readonly required: true;
                            readonly description: "数值 y 字段名";
                        };
                    };
                    readonly additionalProperties: false;
                }, {
                    readonly type: "object";
                    readonly properties: {
                        readonly id: {
                            readonly type: "string";
                            readonly required: true;
                            readonly description: "视图唯一 id（本报告内不重复）";
                        };
                        readonly kind: {
                            readonly type: "string";
                            readonly const: "table";
                            readonly required: true;
                        };
                        readonly datasetId: {
                            readonly type: "string";
                            readonly required: true;
                            readonly description: "引用本次请求中的一个 dataset id";
                        };
                        readonly label: {
                            readonly type: "string";
                            readonly description: "可选视图标题，用于图表可访问名称与空态";
                        };
                        readonly width: {
                            readonly type: "string";
                            readonly enum: readonly ["full", "half"];
                            readonly description: "可选宽度：full 整行 / half 半行（缺省由系统决定）";
                        };
                        readonly columns: {
                            readonly type: "array";
                            readonly items: {
                                readonly type: "string";
                            };
                            readonly description: "可选列白名单；省略时按 dataset 列顺序显示";
                        };
                    };
                    readonly additionalProperties: false;
                }];
            };
        };
    };
    readonly additionalProperties: false;
};
export {};
