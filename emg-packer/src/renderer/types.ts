export interface LayerMeta {
    id: number;
    partId: string;
    type: 'static' | 'switch';
    isDefault?: boolean; // For switch parts, indicates if this layer is the default one
    visible: boolean;
}
