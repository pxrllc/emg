import React, { useEffect, useRef } from 'react';

interface JsonViewerProps {
    data: any;
    highlightId?: string | number | null;
}

export const JsonViewer: React.FC<JsonViewerProps> = ({ data, highlightId }) => {
    const jsonString = JSON.stringify(data, null, 2);
    const lines = jsonString.split('\n');
    const scrollRef = useRef<HTMLDivElement>(null);

    // Naive highlighting: find line containing "partId": "..." or "id": "..." matching highlightId?
    // Or maybe we can't easily map lines to IDs without a sourcemap.
    // Let's just highlight occurrences of the ID for now.

    return (
        <div
            ref={scrollRef}
            className="json-viewer p-4 font-mono text-xs bg-gray-900 text-green-400 overflow-auto h-full"
        >
            {lines.map((line, i) => {
                let isHighlighted = false;
                if (highlightId) {
                    // Very simple check: if line contains the ID string. 
                    // ideally we'd parse properly but this is OK for MVP vis.
                    if (line.includes(`"${highlightId}"`) || line.includes(`: ${highlightId}`)) {
                        isHighlighted = true;
                    }
                }

                return (
                    <div
                        key={i}
                        className={`${isHighlighted ? 'bg-gray-700' : ''} whitespace-pre`}
                    >
                        {line}
                    </div>
                );
            })}
        </div>
    );
};
