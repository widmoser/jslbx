var Color = (function () {
    function Color(alpha, red, green, blue) {
        this.alpha = alpha;
        this.red = red;
        this.green = green;
        this.blue = blue;
    }
    return Color;
}());
var ImageHeader = (function () {
    function ImageHeader(width, height, frameCount, frameDelay, flags, frameOffsets, eofFrameOffset) {
        this.width = width;
        this.height = height;
        this.frameCount = frameCount;
        this.frameDelay = frameDelay;
        this.flags = flags;
        this.frameOffsets = frameOffsets;
        this.eofFrameOffset = eofFrameOffset;
    }
    return ImageHeader;
}());
var Sequence = (function () {
    function Sequence(length) {
        this.length = length;
        this.pixels = [];
    }
    return Sequence;
}());
var Frame = (function () {
    function Frame() {
        this.sequences = [];
    }
    return Frame;
}());
var LBXImage = (function () {
    function LBXImage(header, palette, frames) {
        this.header = header;
        this.palette = palette;
        this.frames = frames;
    }
    LBXImage.prototype.getImageData = function (context, palette, frameIndex) {
        var _this = this;
        if (frameIndex === void 0) { frameIndex = 0; }
        var imageData = context.createImageData(this.header.width, this.header.height);
        var frame = this.frames[frameIndex];
        var offset = 0;
        frame.sequences.forEach(function (seq) {
            var rawPixels = seq.pixels.reduce(function (res, colorIndex) {
                var color = palette[colorIndex];
                return res.concat([color.red, color.green, color.blue, color.alpha]);
            }, []);
            var offset = seq.offset.y * _this.header.width * 4 + seq.offset.x * 4;
            imageData.data.set(rawPixels, offset);
            //offset += rawPixels.length;
        });
        return imageData;
    };
    return LBXImage;
}());
var MASK_JUNCTION = 0x00002000;
var MASK_INTERNAL_PALETTE = 0x00001000;
var MASK_FUNCTIONAL_COLOR = 0x00000800;
var MASK_FILL_BACKGROUND = 0x00000400;
var MASK_NO_COMPRESSION = 0x00000100;
var color = jBinary.Type({
    read: function () {
        this.binary.read('uint8'); // ignore alpha
        var r = this.binary.read('uint8') * 4;
        var g = this.binary.read('uint8') * 4;
        var b = this.binary.read('uint8') * 4;
        return new Color(255, r, g, b);
    },
    write: function (color) {
        this.binary.write('uint8', color.alpha) / 4;
        this.binary.write('uint8', color.red) / 4;
        this.binary.write('uint8', color.green) / 4;
        this.binary.write('uint8', color.blue) / 4;
    }
});
var archive = function (fileType) { return ({
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
        read: function () {
            var base = this.baseRead();
            var palette = new Array(256);
            base.values.forEach(function (v, i) {
                palette[i + base.offset] = v;
            });
            return palette;
        },
        write: function (palette) {
            var isColor = function (v) { return typeof (v) === 'object'; }; // TODO: use Color?
            var offset = palette.findIndex(isColor);
            var filtered = palette.filter(isColor);
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
        read: function () {
            var frameIndicator = this.binary.read('uint16');
            if (frameIndicator !== 1) {
                // skip:
                return;
            }
            var yOffset = this.binary.read('uint16');
            var xOffset = 0;
            var frame = new Frame();
            while (true) {
                var sequenceHeader = this.binary.read('sequenceHeader');
                var sequence = new Sequence(sequenceHeader.length);
                if (sequence.length === 0) {
                    // y offset:
                    var yIncr = sequenceHeader.relXOffset;
                    if (yIncr === 1000) {
                        // end of frame:
                        return frame;
                    }
                    else {
                        yOffset += yIncr;
                        xOffset = 0;
                    }
                }
                else {
                    xOffset += sequenceHeader.relXOffset;
                    for (var i = 0; i < sequence.length; ++i) {
                        var colorIndex = this.binary.read('uint8');
                        sequence.offset = {
                            x: xOffset,
                            y: yOffset
                        };
                        sequence.pixels.push(colorIndex);
                    }
                    if (sequence.length % 2 !== 0) {
                        // odd length
                        this.binary.skip(1);
                    }
                    frame.sequences.push(sequence);
                    xOffset += sequence.length;
                }
            }
        },
        write: function (frame) {
            // todo:
        }
    }),
    image: jBinary.Type({
        read: function () {
            var _this = this;
            var pos = this.binary.tell();
            var header = this.binary.read('imageHeader');
            var palette = (header.flags & MASK_INTERNAL_PALETTE) ? this.binary.read('internalPalette') : undefined;
            return new LBXImage(header, palette, header.frameOffsets.map(function (offset, i) {
                _this.binary.seek(pos + offset);
                return _this.binary.read('frame');
            }));
        }
    }),
    palette: ['array', 'color', 256],
    archive: jBinary.Type({
        setParams: function (fileType) {
            this.fileType = fileType;
        },
        read: function () {
            var _this = this;
            var header = this.binary.read('archiveHeader');
            this.binary.seek(header.offsets[0]);
            return {
                header: header,
                resources: header.offsets.map(function (offset, i) {
                    console.log('Reading ', _this.fileType, i);
                    _this.binary.seek(offset);
                    return _this.binary.read(_this.fileType);
                })
            };
        }
    })
}); };
