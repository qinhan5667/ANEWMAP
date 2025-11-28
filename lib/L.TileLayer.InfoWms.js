L.TileLayer.InfoWms = L.TileLayer.WMS.extend({
    // application/json
    options: {
        infoformat: 'text/html', // 'application/json',
        callfun: undefined
    },
    onAdd: function (map) {
        // Triggered when the layer is added to a map.
        //   Register a click listener, then do all the upstream WMS things
        L.TileLayer.WMS.prototype.onAdd.call(this, map);
        map.on('click', this.getFeatureInfo, this);
    },

    onRemove: function (map) {
        // Triggered when the layer is removed from a map.
        //   Unregister a click listener, then do all the upstream WMS things
        L.TileLayer.WMS.prototype.onRemove.call(this, map);
        map.off('click', this.getFeatureInfo, this);
    },

    getScaleFactors: function () {
        const mapElement = document.querySelector('.ScaleBox');
        let scaleX = 1, scaleY = 1;
        if (mapElement) {
            const style = window.getComputedStyle(mapElement);
            const transform = style.transform || style.webkitTransform || style.mozTransform;

            if (transform && transform !== 'none') {
                const matrix = new DOMMatrixReadOnly(transform);
                scaleX = matrix.a;
                scaleY = matrix.d;
            }
        }
        return { scaleX, scaleY };
    },

    getFeatureInfo: function (evt) {
        // Make an AJAX request to the server and hope for the best

        const { scaleX, scaleY } = this.getScaleFactors(); //由于采用了比例缩放，所以需要缩放参数
        const latlng = this._map.containerPointToLatLng(
            L.point(evt.containerPoint.x / scaleX, evt.containerPoint.y / scaleY)
        );

        // var point = evt.containerPoint; // 点击的屏幕坐标
        // var latlng = this._map.layerPointToLatLng(point); // 转换为经纬度坐标

        // var url = this.getFeatureInfoUrl(evt.latlng), // 默认方法
        var url = this.getFeatureInfoUrl(latlng),
            showResults = L.Util.bind((this.options.callfun ? this.options.callfun : this.showGetFeatureInfo), this);

        var request = new XMLHttpRequest();
        // 设置请求方法与路径
        request.open("get", url);
        // 不发送数据到服务器
        request.send(null);
        //XHR对象获取到返回信息后执行
        request.onload = function () {
            // 解析获取到的数据
            var data = request.responseText;
            var err = typeof data === 'string' ? null : data;
            var doc = (new DOMParser()).parseFromString(data, "text/html");
            if (doc.body.innerHTML.trim().length > 0)
                showResults(err, latlng, data);
        };
        request.onerror = function () {
            var error = request.responseText;
            showResults(error);
        };
    },

    getFeatureInfoUrl: function (latlng) {
        // Construct a GetFeatureInfo request URL given a point
        var point = this._map.latLngToContainerPoint(latlng, this._map.getZoom()),
            size = this._map.getSize(),

            params = {
                request: 'GetFeatureInfo',
                service: 'WMS',
                srs: 'EPSG:4326',
                styles: this.wmsParams.styles,
                transparent: this.wmsParams.transparent,
                version: this.wmsParams.version,
                format: this.wmsParams.format,
                bbox: this._map.getBounds().toBBoxString(),
                height: size.y,
                width: size.x,
                layers: this.wmsParams.layers,
                query_layers: this.wmsParams.layers,
                info_format: this.options.infoformat
            };

        params[params.version === '1.3.0' ? 'i' : 'x'] = Math.round(point.x);
        params[params.version === '1.3.0' ? 'j' : 'y'] = Math.round(point.y);

        return this._url + L.Util.getParamString(params, this._url, true);
    },

    showGetFeatureInfo: function (err, latlng, content) {
        if (err) { console.log(err); return; } // do nothing if there's an error

        // Otherwise show the content in a popup, or something.
        L.popup({ maxWidth: 800 })
            .setLatLng(latlng)
            .setContent(content)
            .openOn(this._map);
    }
});

L.tileLayer.InfoWms = function (url, options) {
    return new L.TileLayer.InfoWms(url, options);
};