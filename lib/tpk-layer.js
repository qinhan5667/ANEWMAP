(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD
        define(['leaflet'], factory);
    } else if (typeof exports === 'object') {
        // CommonJS (Node.js)
        module.exports = factory(require('leaflet'));
    } else {
        // 浏览器全局变量
        if (typeof L === 'undefined') {
            throw new Error('Leaflet must be loaded first');
        }
        factory(L);
    }
}(this, function (L) {
    'use strict';

    /**
     * TPK图层类，扩展自L.TileLayer
     */
    L.TileLayer.TPK = L.TileLayer.extend({
        
        // 初始化方法
        initialize: function (url, options) {
            this._tpkUrl = url;
            this._tpkData = null;
            this._loading = false;
            this._loadPromise = null;
            this._loadcallback = undefined;
            
            // 设置默认选项
            options = L.extend({
                minZoom: 0,
                maxZoom: 20,
                tileSize: 256,
                noWrap: true,
                errorTileUrl: '',
                attribution: 'TPK Tile Layer',
                loadcallback: undefined,
            }, options);
            this._loadcallback = options.loadcallback;
            
            // 调用父类初始化
            L.TileLayer.prototype.initialize.call(this, '', options);
        },

        // 创建瓦片
        createTile: function (coords, done) {
            var tile = L.DomUtil.create('canvas', 'leaflet-tile');
            var size = this.getTileSize();
            tile.width = size.x;
            tile.height = size.y;
            
            this._loadTPKFile().then(function(tpkReader) {
                return tpkReader.getTile(coords.z, coords.x, coords.y);
            }).then(function(tileData) {
                if (tileData && tileData.length > 0) {
                    this._drawTileToCanvas(tile, tileData, done);
                } else {
                    this.tileError(tile, done);
                }
            }.bind(this)).catch(function(error) {
                console.error('Error loading tile:', error);
                this.tileError(tile, done);
            }.bind(this));
            
            return tile;
        },

        // 加载TPK文件
        _loadTPKFile: function () {
            if (this._tpkReader) {
                return Promise.resolve(this._tpkReader);
            }
            
            if (this._loadPromise) {
                return this._loadPromise;
            }
            
            this._loadPromise = new Promise(function (resolve, reject) {
                if (typeof window === 'undefined') {
                    // Node.js环境
                    reject(new Error('Node.js environment not yet supported'));
                    return;
                }
                
                // 浏览器环境 - 使用fetch加载文件
                fetch(this._tpkUrl)
                    .then(function (response) {
                        if (!response.ok) {
                            throw new Error('Failed to load TPK file: ' + response.statusText);
                        }
                        return response.arrayBuffer();
                    })
                    .then(function (arrayBuffer) {
                        // 创建TPK读取器
                        this._tpkReader = new TPKReader();
                        return this._tpkReader.load(arrayBuffer);
                    }.bind(this))
                    .then(function () {
                        resolve(this._tpkReader);
                        if (this._loadcallback) {
                            this._loadcallback(this._tpkReader);
                        }
                    }.bind(this))
                    .catch(function (error) {
                        console.error('Error loading TPK file:', error);
                        reject(error);
                    });
            }.bind(this));
            
            return this._loadPromise;
        },

        // 将瓦片数据绘制到canvas
        _drawTileToCanvas: function (tile, tileData, done) {
            var img = new Image();
            var ctx = tile.getContext('2d');
            
            img.onload = function () {
                ctx.drawImage(img, 0, 0);
                done(null, tile);
            };
            
            img.onerror = function () {
                done(new Error('Failed to load tile image'), tile);
            };
            
            // 创建Blob URL
            var blob = new Blob([tileData], { type: this._determineContentType(tileData) });
            img.src = URL.createObjectURL(blob);
        },

        // 确定内容类型
        _determineContentType: function (data) {
            if (!data || data.length < 4) return 'application/octet-stream';
            
            // PNG
            if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) {
                return 'image/png';
            }
            // JPEG
            if (data[0] === 0xFF && data[1] === 0xD8) {
                return 'image/jpeg';
            }
            // GIF
            if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) {
                return 'image/gif';
            }
            
            return 'application/octet-stream';
        },

        // 错误处理
        tileError: function (tile, done) {
            if (this.options.errorTileUrl) {
                var img = new Image();
                img.onload = function () {
                    var ctx = tile.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    done(null, tile);
                };
                img.onerror = function () {
                    done(new Error('Failed to load error tile'), tile);
                };
                img.src = this.options.errorTileUrl;
            } else {
                done(new Error('Tile not found'), tile);
            }
        }
    });

    // 工厂方法
    L.tileLayer.tpk = function (url, options) {
        return new L.TileLayer.TPK(url, options);
    };

    // TPK读取器类
    function TPKReader() {
        this._zip = null;
        this._mapName = null;
        this._mapserver = null;
    }

    TPKReader.prototype = {
        // 加载TPK文件
        load: function (arrayBuffer) {
            return new Promise(function (resolve, reject) {
                if (typeof JSZip === 'undefined') {
                    reject(new Error('JSZip library is required. Please include jszip.js'));
                    return;
                }
                
                try {
                    this._zip = new JSZip();
                    this._zip.loadAsync(arrayBuffer).then(function () {
                        return this._getMapServer();
                    }.bind(this)).then(function (rootObject) {
                        this._mapserver = rootObject;
                        // 尝试获取地图名称
                        this._mapName = "图层";
                        // 多重安全检查
                        if (rootObject.contents) {
                            var resourceInfo = rootObject.contents;
                            if (resourceInfo && resourceInfo.mapName) {
                                var mapName = resourceInfo.mapName.toString();
                                if (mapName && mapName.trim() !== '') {
                                    this._mapName = mapName;
                                }
                            }
                        }
                        
                        // 如果上述路径没有找到，尝试其他可能的路径
                        if (rootObject.mapName) {
                            var mapName = rootObject.mapName.toString();
                            if (mapName && mapName.trim() !== '') {
                                this._mapName = mapName;
                            }
                        }
                        resolve(this);
                    }.bind(this)).catch(reject);
                } catch (error) {
                    reject(error);
                }
            }.bind(this));
        },

        // 获取mapserver.json
        _getMapServer: function () {
            return new Promise(function (resolve, reject) {
                var mapserverEntry = this._zip.file("servicedescriptions/mapserver/mapserver.json");
                if (!mapserverEntry) {
                    resolve("图层"); // 默认名称
                    return;
                }
                mapserverEntry.async('text').then(function (jsonString) {
                    resolve(JSON.parse(jsonString));
                    return;
                });
            }.bind(this));
        },

        // 获取地图名称
        _getMapName: function () {
            return new Promise(function (resolve, reject) {
                var mapserverEntry = this._zip.file("servicedescriptions/mapserver/mapserver.json");
                if (!mapserverEntry) {
                    resolve("图层"); // 默认名称
                    return;
                }

                mapserverEntry.async('text').then(function (jsonString) {
                    try {
                        var rootObject = JSON.parse(jsonString);
                        // 多重安全检查
                        if (rootObject.contents) {
                            var resourceInfo = rootObject.contents;
                            if (resourceInfo && resourceInfo.mapName) {
                                var mapName = resourceInfo.mapName.toString();
                                if (mapName && mapName.trim() !== '') {
                                    resolve(mapName);
                                    return;
                                }
                            }
                        }
                        
                        // 如果上述路径没有找到，尝试其他可能的路径
                        if (rootObject.mapName) {
                            var mapName = rootObject.mapName.toString();
                            if (mapName && mapName.trim() !== '') {
                                resolve(mapName);
                                return;
                            }
                        }
                        
                        // 返回默认名称
                        resolve("图层");
                    } catch (error) {
                        console.warn('Failed to parse mapserver.json, using default name:', error);
                        resolve("图层");
                    }
                }).catch(function (error) {
                    console.warn('Failed to read mapserver.json, using default name:', error);
                    resolve("图层");
                });
            }.bind(this));
        },

        // 获取瓦片
        getTile: function (z, x, y) {
            return new Promise(function (resolve, reject) {
                try {
                    // 计算层级目录名
                    var l = "0" + z;
                    var lLength = l.length;
                    if (lLength > 2) {
                        l = l.substring(lLength - 2);
                    }
                    l = "L" + l;

                    // 计算行组和列组
                    var packSize = 128;
                    var rGroup = packSize * Math.floor(x / packSize);
                    var cGroup = packSize * Math.floor(y / packSize);

                    // 生成R和C的十六进制名称（补0）
                    var rName = this._toHexString(rGroup);
                    var rbu0 = this._padHexString(rName, 4, "C");
                    
                    var cName = this._toHexString(cGroup);
                    var cbu0 = this._padHexString(cName, 4, "R");

                    // 计算索引
                    var index = (y - cGroup) + packSize * (x - rGroup);

                    // 构建文件路径
                    var bundleBase = "v101/" + this._mapName + "/_alllayers/" + l + "/" + cbu0 + rbu0;
                    var bundlxFileName = bundleBase + ".bundlx";
                    var bundleFileName = bundleBase + ".bundle";

                    // 读取bundlx文件获取偏移量
                    this._readBundlxFile(bundlxFileName, index)
                        .then(function (offset) {
                            // 读取bundle文件获取瓦片数据
                            return this._readBundleFile(bundleFileName, offset);
                        }.bind(this))
                        .then(resolve)
                        .catch(function (error) {
                            // 如果第一次尝试失败，使用默认的"图层"名称重试
                            if (this._mapName !== '图层') {
                                bundleBase = "v101/图层/_alllayers/" + l + "/" + cbu0 + rbu0;
                                bundlxFileName = bundleBase + ".bundlx";
                                bundleFileName = bundleBase + ".bundle";
                                
                                this._readBundlxFile(bundlxFileName, index)
                                    .then(function (offset) {
                                        return this._readBundleFile(bundleFileName, offset);
                                    }.bind(this))
                                    .then(resolve)
                                    .catch(reject);
                            } else {
                                reject(error);
                            }
                        }.bind(this));

                } catch (error) {
                    reject(error);
                }
            }.bind(this));
        },

        // 读取bundlx文件
        _readBundlxFile: function (bundlxFileName, index) {
            return new Promise(function (resolve, reject) {
                var bundlxFile = this._zip.file(bundlxFileName);
                if (!bundlxFile) {
                    // 如果直接查找失败，进行大小写不敏感查找
                    var lowerCaseName = bundlxFileName.toLowerCase();
                    var files = this._zip.file(/.*/);
                    
                    for (var i = 0; i < files.length; i++) { // 此方法效率低，待改进
                        if (files[i].name.toLowerCase() === lowerCaseName) {
                            bundlxFile = files[i];
                            break;
                        }
                    }
                    if (!bundlxFile) {
                        reject(new Error('Bundlx file not found: ' + bundlxFileName));
                        return;
                    }
                }

                bundlxFile.async('uint8array').then(function (data) {
                    var offset = 16 + 5 * index;
                    if (offset + 5 > data.length) {
                        reject(new Error('Invalid tile index'));
                        return;
                    }

                    // 读取5字节的偏移量（小端序）
                    var tileOffset = 0;
                    for (var i = 0; i < 5; i++) {
                        tileOffset |= (data[offset + i] & 0xFF) << (8 * i);
                    }

                    resolve(tileOffset);
                }).catch(reject);
            }.bind(this));
        },

        // 读取bundle文件
        _readBundleFile: function (bundleFileName, offset) {
            return new Promise(function (resolve, reject) {
                var bundleFile = this._zip.file(bundleFileName);
                if (!bundleFile) {
                    // 如果直接查找失败，进行大小写不敏感查找
                    var lowerCaseName = bundleFileName.toLowerCase();
                    var files = this._zip.file(/.*/);
                    
                    for (var i = 0; i < files.length; i++) { // 此方法效率低，待改进
                        if (files[i].name.toLowerCase() === lowerCaseName) {
                            bundleFile = files[i];
                            break;
                        }
                    }
                    if (!bundleFile) {
                        reject(new Error('Bundle file not found: ' + bundleFileName));
                        return;
                    }
                }

                bundleFile.async('uint8array').then(function (data) {
                    if (offset + 4 > data.length) {
                        reject(new Error('Invalid tile offset'));
                        return;
                    }

                    // 读取数据长度（4字节，小端序）
                    var length = 0;
                    for (var i = 0; i < 4; i++) {
                        length |= (data[offset + i] & 0xFF) << (8 * i);
                    }

                    if (offset + 4 + length > data.length) {
                        reject(new Error('Invalid tile data length'));
                        return;
                    }

                    // 提取瓦片数据
                    var tileData = data.slice(offset + 4, offset + 4 + length);
                    resolve(tileData);
                }).catch(reject);
            }.bind(this));
        },

        // 转换为十六进制字符串
        _toHexString: function (num) {
            return num.toString(16).toUpperCase();
        },

        // 补全十六进制字符串
        _padHexString: function (hexStr, length, prefix) {
            var result = hexStr;
            if (result.length < length) {
                var zeros = '0'.repeat(length - result.length);
                result = zeros + result;
            }
            return prefix + result;
        }
    };

    return L.TileLayer.TPK;
}));