import { useEffect, useState } from "react";

export function useMuxyData() {
    const [data, setData] = useState(() => window.muxy?.data);
    useEffect(() => {
        window.muxy?.onDataChange?.((next) => setData(next));
    }, []);
    return data;
}
