import path from 'path';
import { normalizePath } from 'vite';
import { readAllFile, isRegExp, isFunction } from './utils.js';
import fs from 'fs-extra';
import chalk from 'chalk';
import zlib from 'zlib';
const extRE = /\.(js|mjs|json|css|html)$/i;
const mtimeCache = new Map();
export default function (options = {}) {
    let outputPath;
    let config;
    const emptyPlugin = {
        name: 'vite:compression',
    };
    const { disable = false, filter = extRE, verbose = true, threshold = 1025, compressionOptions = {}, deleteOriginFile = false, 
    // eslint-disable-next-line
    success = () => { }, } = options;
    let { ext = '' } = options;
    const { algorithm = 'gzip' } = options;
    if (algorithm === 'gzip' && !ext) {
        ext = '.gz';
    }
    if (algorithm === 'brotliCompress' && !ext) {
        ext = '.br';
    }
    if (disable) {
        return emptyPlugin;
    }
    return Object.assign(Object.assign({}, emptyPlugin), { apply: 'build', enforce: 'post', configResolved(resolvedConfig) {
            config = resolvedConfig;
            outputPath = path.isAbsolute(config.build.outDir)
                ? config.build.outDir
                : path.join(config.root, config.build.outDir);
        },
        async closeBundle() {
            let files = readAllFile(outputPath) || [];
            if (!files.length)
                return;
            files = filterFiles(files, filter);
            const compressOptions = getCompressionOptions(algorithm, compressionOptions);
            const compressMap = new Map();
            const handles = files.map(async (filePath) => {
                const { mtimeMs, size: oldSize } = await fs.stat(filePath);
                if (mtimeMs <= (mtimeCache.get(filePath) || 0) || oldSize < threshold)
                    return;
                let content = await fs.readFile(filePath);
                if (deleteOriginFile) {
                    fs.remove(filePath);
                }
                try {
                    content = await compress(content, algorithm, compressOptions);
                }
                catch (error) {
                    config.logger.error('compress error:' + filePath);
                }
                const size = content.byteLength;
                const cname = getOutputFileName(filePath, ext);
                compressMap.set(filePath, {
                    size: size / 1024,
                    oldSize: oldSize / 1024,
                    cname: cname,
                });
                await fs.writeFile(cname, content);
                mtimeCache.set(filePath, Date.now());
            });
            Promise.all(handles).then(() => {
                if (verbose) {
                    handleOutputLogger(config, compressMap, algorithm);
                    success();
                }
            });
        } });
}
function filterFiles(files, filter) {
    if (filter) {
        const isRe = isRegExp(filter);
        const isFn = isFunction(filter);
        files = files.filter((file) => {
            if (isRe) {
                return filter.test(file);
            }
            if (isFn) {
                // eslint-disable-next-line
                return filter(file);
            }
            return true;
        });
    }
    return files;
}
/**
 * get common options
 */
function getCompressionOptions(algorithm = '', compressionOptions = {}) {
    const defaultOptions = {
        gzip: {
            level: zlib.constants.Z_BEST_COMPRESSION,
        },
        deflate: {
            level: zlib.constants.Z_BEST_COMPRESSION,
        },
        deflateRaw: {
            level: zlib.constants.Z_BEST_COMPRESSION,
        },
        brotliCompress: {
            params: {
                [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
                [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
            },
        },
    };
    return Object.assign(Object.assign({}, defaultOptions[algorithm]), compressionOptions);
}
/**
 * Compression core method
 * @param content
 * @param algorithm
 * @param options
 */
function compress(content, algorithm, options = {}) {
    return new Promise((resolve, reject) => {
        // @ts-ignore
        zlib[algorithm](content, options, (err, result) => err ? reject(err) : resolve(result));
    });
}
/**
 * Get the suffix
 * @param filepath
 * @param ext
 */
function getOutputFileName(filepath, ext) {
    const compressExt = ext.startsWith('.') ? ext : `.${ext}`;
    return `${filepath}${compressExt}`;
}
// Packed output logic
function handleOutputLogger(config, compressMap, algorithm) {
    config.logger.info(`\n${chalk.cyan('✨ [vite-plugin-compression]:algorithm=' + algorithm)}` +
        ` - compressed file successfully: `);
    const keyLengths = Array.from(compressMap.keys(), (name) => name.length);
    const maxKeyLength = Math.max(...keyLengths);
    compressMap.forEach((value, name) => {
        const { size, oldSize, cname } = value;
        const rName = normalizePath(cname).replace(normalizePath(`${config.build.outDir}/`), '');
        const sizeStr = `${oldSize.toFixed(2)}kb / ${algorithm}: ${size.toFixed(2)}kb`;
        config.logger.info(chalk.dim(path.basename(config.build.outDir) + '/') +
            chalk.blueBright(rName) +
            ' '.repeat(2 + maxKeyLength - name.length) +
            ' ' +
            chalk.dim(sizeStr));
    });
    config.logger.info('\n');
}
