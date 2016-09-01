declare const jBinary: any;

class Color {
    constructor(
        public alpha: number,
        public red: number,
        public green: number,
        public blue: number
    ) {}
}

class ImageHeader {
    constructor(
        public width: number,
        public height: number,
        public frameCount: number,
        public frameDelay: number,
        public flags: number,
        public frameOffsets: number[],
        public eofFrameOffset: number
    ) {}
}

class Sequence {

    public pixels: number[];
    public offset: { x: number, y: number };

    constructor(public length: number) {
        this.pixels = [];
    }


}

class Frame {
    public sequences: Sequence[];

    constructor() {
        this.sequences = [];
    }
}

class LBXImage {
    constructor(
        public header: ImageHeader,
        public palette: Color[],
        public frames: Frame[]
    ) {
    }

    public getImageData(context, palette, frameIndex: number = 0) {
        const imageData = context.createImageData(this.header.width, this.header.height);
        const frame = this.frames[frameIndex];
        let offset = 0;
        frame.sequences.forEach(seq => {
            const rawPixels = seq.pixels.reduce((res, colorIndex) => {
                const color = palette[colorIndex];
                return res.concat([color.red, color.green, color.blue, color.alpha]);
            }, []);
            const offset = seq.offset.y*this.header.width*4 + seq.offset.x*4;
            imageData.data.set(rawPixels, offset);
            //offset += rawPixels.length;
        });
        return imageData;
    }

}

const MASK_JUNCTION = 0x00002000;
const MASK_INTERNAL_PALETTE = 0x00001000;
const MASK_FUNCTIONAL_COLOR = 0x00000800;
const MASK_FILL_BACKGROUND = 0x00000400;
const MASK_NO_COMPRESSION = 0x00000100;

const color = jBinary.Type({
    read: function() {
        this.binary.read('uint8'); // ignore alpha
        const r = this.binary.read('uint8')*4;
        const g = this.binary.read('uint8')*4;
        const b = this.binary.read('uint8')*4;
        return new Color(255, r, g, b);
    },
    write: function(color: Color) {
        this.binary.write('uint8', color.alpha)/4;
        this.binary.write('uint8', color.red)/4;
        this.binary.write('uint8', color.green)/4;
        this.binary.write('uint8', color.blue)/4;
    }
});

const archive = (fileType) => ({ 
    'jBinary.all': ['archive', fileType],
    'jBinary.littleEndian': true,
    color: color,
    archiveHeader: {
        fileCount: 'uint16',
        verificationCode: ['const', 'uint32', 65197],
        flags: 'uint16',
        offsets: ['array', 'uint32', 'fileCount'],
        fileSize: 'uint32'
    },
    imageHeader: {
        width: 'uint16',
        height: 'uint16',
        notUsed: 'uint16',
        frameCount: 'uint16',
        frameDelay: 'uint16',
        flags: 'uint16',
        frameOffsets: ['array', 'uint32', 'frameCount'],
        eofFrameOffset: 'uint32'
    },
    internalPalette: jBinary.Template({
        baseType: {
            offset: 'uint16',
            length: 'uint16',
            values: ['array', 'color', 'length']
        },
        read: function() {
            const base = this.baseRead();
            const palette = new Array(256);
            base.values.forEach((v, i) => {
                palette[i + base.offset] = v;
            });
            return palette;
        },
        write: function(palette) {
            const isColor = v => typeof(v) === 'object'; // TODO: use Color?
            const offset = palette.findIndex(isColor)
            const filtered = palette.filter(isColor);
            this.base.write({
                offset: offset,
                length: filtered.length,
                values: filtered
            });
        }
    }),
    sequenceHeader: {
        length: 'uint16',
        relXOffset: 'uint16'
    },
    frame: jBinary.Type({
        read: function() {
            let frameIndicator = this.binary.read('uint16');
            if (frameIndicator !== 1) {
                // skip:
                return;
            }
            let yOffset = this.binary.read('uint16');
            let xOffset = 0;
            const frame = new Frame();
            while (true) {

                const readSequenceHeader = () => this.binary.read('sequenceHeader');

                const length = this.view.getUint16(undefined, true);
                const relXOffset = this.view.getUint16(undefined, true);
                const sequence = new Sequence(length);
                if (sequence.length === 0) {
                    // y offset:
                    const yIncr = relXOffset;
                    if (yIncr === 1000) {
                        // end of frame:
                        return frame;
                    } else {
                        yOffset += yIncr;
                        xOffset = 0;
                    }
                } else {
                    xOffset += relXOffset;
                    sequence.offset = {
                        x: xOffset,
                        y: yOffset
                    };
                    sequence.pixels = this.view.getBytes(sequence.length, undefined, true, true);

                    if (sequence.length % 2 !== 0) {
                        // odd length
                        this.binary.skip(1);
                    }

                    frame.sequences.push(sequence);
                    xOffset += sequence.length;
                }
            }
        },
        write: function(frame) {
            // todo:
        }
    }),
    image: jBinary.Type({
        read: function() {
            const pos = this.binary.tell();
            const header = this.binary.read('imageHeader');
            const palette = (header.flags & MASK_INTERNAL_PALETTE) ? this.binary.read('internalPalette') : undefined;
            return new LBXImage(
                header,
                palette,
                header.frameOffsets.map((offset, i) => {
                    this.binary.seek(pos + offset);
                    return this.binary.read('frame');
                }));
        }
    }),
    palette: ['array', 'color', 256],
    archive: jBinary.Type({
        setParams: function(fileType) {
            this.fileType = fileType;
        },
        read: function() {
            const header = this.binary.read('archiveHeader');
            this.binary.seek(header.offsets[0]);
            return {
                header: header,
                resources: header.offsets.map((offset, i) => {
                    this.binary.seek(offset);
                    return this.binary.read(this.fileType);
                })
            }
        }
    })
})