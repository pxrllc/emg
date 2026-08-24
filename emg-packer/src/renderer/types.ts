export interface LayerMeta {
    id: number;
    partId: string;
    type: 'static' | 'switch';
    isDefault?: boolean; // For switch parts, indicates if this layer is the default one
    /**
     * v0.5.0 §2。このレイヤーが属するフレームの名前。
     * PSD で「@」始まりのグループに入っているレイヤーに付く（下の traverse を参照）。
     * 未設定なら textureID がそのままフレーム識別子になる。
     */
    frameName?: string;
    visible: boolean;
    opacity: number;    // 0.0 - 1.0
    blendMode: string;  // 'normal' | 'multiply' | 'screen' | etc.
}
