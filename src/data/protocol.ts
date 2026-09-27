// Messages between the extension host and the data worker.

export type Kind = 'num' | 'time' | 'text' | 'array';
export type Format = 'csv' | 'jsonl' | 'json' | 'sqlite' | 'parquet' | 'xlsx';

export interface TableInfo {
    name: string;
    rows: number;
    columns: number;
}

export interface ColumnInfo {
    name: string;
    kind: Kind;
}

export type SourceSpec =
    | { kind: 'file'; path: string; table?: string }
    | { kind: 'folder'; path: string };

export interface OpenOptions {
    /** Cells kept per source before the oldest rows are dropped. */
    budgetCells?: number;
    /** Most rows kept per source, whatever the width. */
    budgetRows?: number;
}

export type ToWorker =
    | { type: 'open'; id: number; spec: SourceSpec; options?: OpenOptions }
    | { type: 'close'; id: number }
    /** Send the schema and every kept row again (a webview reloaded). */
    | { type: 'resend'; id: number }
    /** Read every row in [from, to) of the file (rows counted from 0), for detail inside an overview. */
    | { type: 'range'; id: number; from: number; to: number };

/** New values for one column. Rows are absolute: row 0 is the first data row of the file. */
export interface ColumnDelta {
    name: string;
    kind: Kind;
    /** num and time columns; NaN marks an empty cell. Time is seconds since the epoch. */
    values?: Float64Array;
    /** text columns: an index into the dictionary, -1 for an empty cell. */
    codes?: Int32Array;
    /** Dictionary entries added since the last delta, starting at index `dictStart`. */
    dictStart?: number;
    dict?: string[];
    /** array columns: every array in this delta packed end to end (only the newest are kept). */
    packed?: Float64Array;
    /** Length of each packed array, in order. */
    lengths?: Int32Array;
    /** The absolute row of each packed array. */
    arrayRows?: Float64Array;
}

export type SchemaReason = 'opened' | 'switched' | 'replaced' | 'truncated' | 'columns';

export type FromWorker =
    /** The columns changed; the client drops what it has and a full `rows` message follows. */
    | { type: 'schema'; id: number; file: string; format: Format; columns: ColumnInfo[]; reason: SchemaReason }
    | { type: 'rows'; id: number; first: number; count: number; dropped: number; columns: ColumnDelta[] }
    | { type: 'bindings'; id: number; bindings: Record<string, string> }
    | { type: 'status'; id: number; file: string; state: 'waiting' | 'reading' | 'tailing' | 'missing'; bytesRead: number; size: number; rows: number; lastGrowth: number; badLines: number; stride: number; fileRows: number }
    | { type: 'renamed'; id: number; from: string; to: string }
    /** Tables (SQLite), sheets (Excel) or the one table of a Parquet file; sent before any data. */
    | { type: 'tables'; id: number; file: string; tables: TableInfo[]; table: string | null }
    | { type: 'error'; id: number; message: string }
    /** Every row of a range, answering `range`. */
    | { type: 'detail'; id: number; first: number; count: number; columns: ColumnInfo[]; deltas: ColumnDelta[] };
