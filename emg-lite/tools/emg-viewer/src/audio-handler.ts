
export interface AudioDevice {
    deviceId: string;
    label: string;
}

export class AudioHandler {
    private audioContext: AudioContext | undefined;
    private analyser: AnalyserNode | undefined;
    private mediaStream: MediaStream | undefined;
    private animationId: number | undefined;
    private onVolumeCallback: ((volume: number) => void) | undefined;

    constructor() { }

    /**
     * Get list of available audio input devices
     */
    public async getDevices(): Promise<AudioDevice[]> {
        // Enumerate devices
        // Note: Labels might be empty if permission not granted yet. 
        // We might need to ask permission first, but usually enumerate gives IDs at least.
        try {
            await navigator.mediaDevices.getUserMedia({ audio: true }); // Ask permission first to ensure labels are visible
            const devices = await navigator.mediaDevices.enumerateDevices();
            return devices
                .filter(d => d.kind === 'audioinput')
                .map(d => ({ deviceId: d.deviceId, label: d.label || `Microphone ${d.deviceId.slice(0, 5)}...` }));
        } catch (e) {
            console.error('Error getting audio devices:', e);
            return [];
        }
    }

    public async start(deviceId: string, onVolume: (volume: number) => void) {
        this.stop();
        this.onVolumeCallback = onVolume;

        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: deviceId ? { exact: deviceId } : undefined
                }
            });

            this.audioContext = new AudioContext();
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.analyser.smoothingTimeConstant = 0.5;

            source.connect(this.analyser);

            this.analyzeLoop();
        } catch (e) {
            console.error('Failed to start audio:', e);
            if (this.mediaStream) {
                this.mediaStream.getTracks().forEach(t => t.stop());
            }
        }
    }

    public stop() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = undefined;
        }
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = undefined;
        }
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = undefined;
        }
    }

    private analyzeLoop = () => {
        if (!this.analyser) return;

        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        this.analyser.getByteFrequencyData(dataArray);

        // Calculate simple volume (average)
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
        }
        const average = sum / bufferLength;
        const normalized = Math.min(1, average / 128); // 0.0 - 1.0 (Approx)

        if (this.onVolumeCallback) {
            this.onVolumeCallback(normalized);
        }

        this.animationId = requestAnimationFrame(this.analyzeLoop);
    };
}
