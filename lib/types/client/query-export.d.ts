/** One structured result shape accepted by every workbench export. */
export interface QueryExportData {
    columns: readonly string[];
    rows: readonly Readonly<Record<string, string | null>>[];
}
/** UTF-8 CSV with BOM so desktop Excel opens Chinese text correctly. */
export declare function queryResultToCsv(data: QueryExportData): string;
/** Tabular plain text suitable for spreadsheet clipboard paste. */
export declare function queryResultToTsv(data: QueryExportData): string;
/** Build a real XLSX workbook using inline strings, frozen headers, and filters. */
export declare function queryResultToXlsx(data: QueryExportData): Uint8Array;
