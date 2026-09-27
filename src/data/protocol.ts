// Messages between the extension host and the data worker.

export type Kind = 'num' | 'time' | 'text' | 'array';
export type Format = 'csv' | 'jsonl' | 'json';

export interface ColumnInfo {
    name: string;
    kind: Kind;
}

export type SourceSpec =
    | { kind: 'file'; path: string }
    | { kind: 'folder'; path: string };

export interface OpenOptions {
    /** Cells kept per source before the oldest rows are dropped. */
    budgetCells?: number;
    /** Most rows kept per source, whatever the width. */
    budgetRows?: number;
}

export type ToWorker =
    | { type: 'open'; id: number; spec: SourceSpec; options?: OpenOptions }
    | { type: 'close'; id: number };

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
    /** array columns: the arrays in this delta (only the newest ones are kept, see `arrayRows`). */
    arrays?: Float64Array[];
    /** The absolute row of each entry in `arrays`. */
    arrayRows?: number[];
}

export type SchemaReason = 'opened' | 'switched' | 'replaced' | 'truncated' | 'columns';

export type FromWorker =
    /** The columns changed; the client drops what it has and a full `rows` message follows. */
    | { type: 'schema'; id: number; file: string; format: Format; columns: ColumnInfo[]; reason: SchemaReason }
    | { type: 'rows'; id: number; first: number; count: number; dropped: number; columns: ColumnDelta[] }
    | { type: 'bindings'; id: number; bindings: Record<string, string> }
    | { type: 'status'; id: number; file: string; state: 'waiting' | 'reading' | 'tailing' | 'missing'; bytesRead: number; size: number; rows: number; lastGrowth: number; badLines: number }
    | { type: 'renamed'; id: number; from: string; to: string }
    | { type: 'error'; id: number; message: string };
