/**
 * A Display governs all activity targeting a specific output div.
 * @param name {string}
 * @param params {Object}
 * @constructor
 */

function Display(name, params) {

    this.name = name;
    this._width = 100;
    this._height = 100;
    this._scenes = {};
    this._cameras = {};
    this._objects = [];
    this._mats = {};

    this.active = true;
    this.update_on_animate = true;

    if (params) {

        var tokens = _.pick(params, Display.PROPERTIES);
        delete params.width;
        delete params.height;
        _.extend(this, params);
        _.each(tokens, function (value, name) {
            this[name].call(this, value);
        }, this);
    }

    this.addListener('resized', function () {
        if (this._renderer) {
            this._renderer.setSize(this.width(), this.height());
        }
        _.each(this._cameras, function (c) {
            if (c.aspect) {
                c.aspect = this.width() / this.height();
                c.updateProjectionMatrix();
            }
        }, this);
    }.bind(this));
}

O3.util.inherits(Display, EventEmitter);

_.extend(
    Display.prototype, {

        mats: function (filter) {
            return filter ? _.where(_.values(this._mats), filter) : _.values(this._mats);
        },

        mat: function (name, params, value) {
            if (!this._mats[name]) {
                if (params === false) {
                    return null;
                }

                params = params || {};
                _.extend(params, {context: this});
                var p = new MatProxy(name, params);
                this._mats[name] = p;
                this._mats[name].addListener('refresh', function () {
                    p.emit('refresh');
                }.bind(this))
            } else if (params) {
                if (_.isString(params)) {
                    this._mats[name].set(params, value);
                } else if (_.isObject(params)) {
                    this._mats[name].set_params(params);
                }
            }
            return this._mats[name];
        },

        mat_values: function (name) {
            return _.reduce(_.compact([
                O3.mat(name).params(), local_mat(name).params()
            ], function (o, p) {
                return _.extend(o, p)
            }, {}));

        },

        add: function (object, scene) {
            this._objects.push(object);

            var s = this.scene(scene);
            s.add(object.obj());
            object.scene = s;
            object.display = this;
            return object;
        },

        I_HAVE_LIGHT: true,

        light: function (type, name) {
            var ro = new RenderObject().light(type);
            this.add(ro);
            return name ? ro.n(name) : ro;
        },

        ro: function () {
            var name, geo, mat, mesh, light, update, params;

            var args = _.toArray(arguments);

            _.each(args, function (a) {
                if (_.isString(a)) {
                    name = a;
                    return;
                }
                if (_.isObject(a)) {
                    if (a instanceof THREE.Geometry) {
                        geo = a;
                        return;
                    }
                    if (a instanceof THREE.Material) {
                        mat = a;
                        return;
                    }
                    if (a instanceof THREE.Mesh) {
                        mesh = a;
                        return;
                    }
                    if (a instanceof THREE.Light) {
                        light = a;
                        return;
                    }
                    params = a;
                    return;
                }

                if (_.isFunction(a)) {
                    if (params) {
                        params.update = a;
                    } else {
                        params = {
                            update: a
                        }
                    }

                }
            });

            mesh = mesh || light || new THREE.Mesh(geo, mat);

            var ro = new RenderObject(mesh, params);
            ro.name = name || 'ro #' + ro.id;
            ro.display = this;

            this.add(ro);

            return ro;

        },

        find: function (query) {
            return _.where(this._objects, query);
        },

        objects: function (readonly) {
            return readonly ? this._objects : this._objects.slice();
        },
        remove: function (object) {
            object.scene.remove(object.obj());
            this._objects = _.reject(this._objects, function (o) {
                return o === object;
            });
        },

        destroy: function () {
            this.emit('destroy');
        },

        scenes: function () {
            return _.keys(this._scenes);
        },

        camera: function (name, value) {

            if (_.isObject(name)) {
                value = name;
                name = '';
            }

            if (!name) {
                name = this._default_camera || 'default';
            }
            if (value || !this._cameras[name]) {

                var self = this;
                this._cameras[name] = _.extend(value || new THREE.PerspectiveCamera(),
                    {
                        name: name,
                        activate: function () {
                            self._default_camera = this.name;
                        }
                    }
                )
                this._cameras[name].aspect = this.width() / this.height(); // note - irrelevant (but harmless) for orthographic camera
                this._cameras[name].updateProjectionMatrix();

                this.emit('camera added', this._cameras[name]);
            }

            return this._cameras[name]
        },

        /**
         * note - unlike other properties, this class is not set up to
         * be updated more than once.
         *
         * @param renderer
         * @returns {*|THREE.WebGLRenderer}
         */
        renderer: function (renderer) {

            if (renderer) {
                this._renderer = renderer;
            } else if (!this._renderer) {
                this._renderer = new THREE.WebGLRenderer();
                this._renderer.setSize(this.width(), this.height());
            }

            this._extend_renderer();

            return this._renderer;
        },

        _extend_renderer: function () {
            if (!this._renderer._extended) {
                _.extend(this._renderer,
                    {
                        _extended: 1,

                        shadows: function (s, mode) {
                            if (!arguments.length) {
                                s = true;
                            }

                            this.shadowMapEnabled = s;

                            if (typeof mode != 'undefined') {
                                this.shadowMapType = mode || 0;
                            }

                            return this;
                        }
                    })
            }
        },

        shadows: function (s, m) {
            return this.renderer().shadows(s, m);
        },

        scene: function (name, value) {

            if (_.isObject(name)) {
                value = name;
                name = '';
            }

            if (!name) {
                name = this._default_scene || 'default';
            }
            if (value || !this._scenes[name]) {

                var self = this;
                this._scenes[name] = _.extend(value || new THREE.Scene(),
                    {
                        name: name,
                        activate: function () {
                            self._default_scene = this.name;
                        }
                    }
                )
                ;
                this.emit('scene added', this._scenes[name]);
            }
            return this._scenes[name]
        },

        size: function (w, h) {
            if (arguments.length) {
                var old_height = this.height(), old_width = this.height();
                this.width(w, true);
                this.height(h, true);
                this.emit('resized', this._width, this._height, old_width, old_height);
            }
            return [this.width(), this.height()];
        },

        append: function (parent) {
            var dom = this.renderer().domElement;

            if (!dom) {
                throw new Error('no domElement on renderer');
            }
            parent.appendChild(dom);
        },

        height: function (value, noEmit) {
            if (arguments.length && (value != this._height)) {
                var old_height = this.height(), old_width = this.width();
                O3.util.assign(this, '_height', value,
                    O3.util.as_test(_.isNumber, 'height must be a number'),
                    function (v) {
                        if (v <= 0) {
                            return 'height must be > 0'
                        }
                    }
                );
                if (!noEmit) {
                    this.emit('resized', this._width, this._height, old_width, old_height);
                }
            }

            return this._height;
        },

        width: function (value, noEmit) {

            if (arguments.length && value != this._width) {
                var old_height = this._height, old_width = this._width;
                O3.util.assign(this, '_width', value,
                    O3.util.as_test(_.isNumber, 'width must be a number'),
                    function (v) {
                        return v <= 0 ? 'width must be > 0' : false;
                    }
                );
                if (!noEmit) {
                    this.emit('resized', this._width, this._height, old_width, old_height);
                }
            }

            return this._width;
        },

        update: function (from_ani) {
            _.each(this._objects, function (o) {
                if ((!from_ani) || (o.update_on_animate)) {
                    o.emit('update');
                }
            })
        },

        /**
         *
         * @param camera {Three.Camera} (optional)
         * @param scene {Three.Scene} (optional)
         */
        render: function (camera, scene) {
            this.renderer().render(scene || this.scene(), camera || this.camera());
        },

        /**
         * render continuously
         * @param t
         */
        animate: function (t) {
            this.emit('animate', t);
            _.each(this.objects(1), function (o) {
                o.emit('animate', t);
            });

            if (this.active && this.update_on_animate) {
                if (this.update_on_animate) {
                    this.update(true);
                }
                this.render();
            }
        }

    })
;

Display.PROPERTIES = [ 'width', 'height', 'camera', 'scene', 'renderer'];