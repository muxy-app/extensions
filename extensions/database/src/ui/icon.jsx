const PATHS = {
    database: "M12 3c-4.14 0-7.5 1.34-7.5 3v12c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3V6c0-1.66-3.36-3-7.5-3Zm7.5 3c0 1.66-3.36 3-7.5 3S4.5 7.66 4.5 6m15 6c0 1.66-3.36 3-7.5 3s-7.5-1.34-7.5-3",
    plus: "M12 5v14M5 12h14",
    trash: "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2",
    pencil: "M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 3 21.5l1-4.5L17 3Z",
    copy: "M8 8h12v12H8zM16 8V4H4v12h4",
    play: "M7 5v14l12-7L7 5Z",
    refresh: "M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6",
    table: "M3 5h18v14H3zM3 10h18M9 10v9",
    eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
    chevronRight: "M9 6l6 6-6 6",
    chevronDown: "M6 9l6 6 6-6",
    x: "M6 6l12 12M18 6L6 18",
    search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35",
    check: "M5 13l4 4L19 7",
    key: "M15 9a6 6 0 1 0-5.65 5.99L11 17h2v2h2v2h4v-3l-5.35-5.35A5.97 5.97 0 0 0 15 9Zm-4-2a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z",
    bolt: "M13 2 4 14h6l-1 8 9-12h-6l1-8Z",
    folder: "M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z",
    link: "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5",
    clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l3 3",
    save: "M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 0v5h8V3M7 21v-8h10v8",
    star: "M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9L12 3Z",
    download: "M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
    upload: "M12 15V3m0 0 4 4m-4-4-4 4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
    filter: "M4 5h16l-6 7v6l-4 2v-8L4 5Z",
    left: "M15 6l-6 6 6 6",
    right: "M9 6l6 6-6 6",
    warning: "M12 4 2 20h20L12 4Zm0 6v5m0 3v.5",
    terminal: "M4 17l6-5-4-5M12 19h8",
    columns: "M12 4v16M4 4h16v16H4z",
    dots: "M5 12h.01M12 12h.01M19 12h.01",
    server: "M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01",
    file: "M6 2h9l5 5v15H6V2Zm9 0v5h5",
    grid: "M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z",
    code: "M8 6 2 12l6 6M16 6l6 6-6 6",
    info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v.5M12 11v6",
};

export function Icon({ name, size = 14 }) {
    return (
        <svg
            viewBox="0 0 24 24"
            width={size}
            height={size}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d={PATHS[name] || PATHS.info} />
        </svg>
    );
}
