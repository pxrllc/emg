
export class AudioMonitor {
    private audioContext: AudioContext | null = null;
    private analyser: AnalyserNode | null = null;
    private microphone: MediaStreamAudioSourceNode | null = null;
    private dataArray: Uint8Array | null = null;
    private cleanup: (() => void) | null = null;

    // Smoothed Volume
    private currentVolume: number = 0;
    private decayRate: number = 0.2; // How fast volume drops (0.0 - 1.0)

    // Threshold for "Open"
    public threshold: number = 20; // 0-255 based on byte frequency? Or just RMS?

    async start() {
        if (this.audioContext) return;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.microphone = this.audioContext.createMediaStreamSource(stream);
            this.microphone.connect(this.analyser);

            const bufferLength = this.analyser.frequencyBinCount;
            this.dataArray = new Uint8Array(bufferLength);

            this.cleanup = () => {
                stream.getTracks().forEach(track => track.stop());
                if (this.audioContext && this.audioContext.state !== 'closed') {
                    this.audioContext.close();
                }
            };

            console.log('Microphone started');

        } catch (e) {
            console.error('Failed to access microphone:', e);
            throw e;
        }
    }

    stop() {
        if (this.cleanup) {
            this.cleanup();
            this.cleanup = null;
        }
        this.audioContext = null;
        this.analyser = null;
        this.microphone = null;
    }


    getVolume(): number {
        if (!this.analyser || !this.dataArray) return 0;

        this.analyser.getByteFrequencyData(this.dataArray as any);

        let sum = 0;
        for (let i = 0; i < this.dataArray.length; i++) {
            sum += this.dataArray[i];
        }
        const average = sum / this.dataArray.length; // 0-255 approx

        // Smoothing
        if (average > this.currentVolume) {
            this.currentVolume = average; // Attack is instant
        } else {
            this.currentVolume -= (this.currentVolume - average) * this.decayRate; // Decay
        }

        return this.currentVolume;
    }
}
