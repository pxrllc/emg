export interface LayerMeta {
    id: number;
    partId: string;
    type: 'static' | 'switch';
    isDefault?: boolean; // For switch parts, indicates if this layer is the default one
    visible: boolean;
    opacity: number;    // 0.0 - 1.0
    blendMode: string;  // 'normal' | 'multiply' | 'screen' | etc.
}
