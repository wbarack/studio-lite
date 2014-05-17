/**
 Scene Editor Backbone view
 @class SceneEditorView
 @constructor
 @return {object} instantiated SceneEditorView
 **/
define(['jquery', 'backbone', 'fabric', 'BlockScene', 'BlockRSS', 'ScenesToolbarView'], function ($, Backbone, fabric, BlockScene, BlockRSS, ScenesToolbarView) {

    BB.SERVICES.SCREEN_LAYOUT_EDITOR_VIEW = 'SceneEditorView';

    var SceneEditorView = BB.View.extend({

        /**
         Constructor
         @method initialize
         **/
        initialize: function () {
            var self = this;
            BB.comBroker.setService(BB.SERVICES['SCENE_EDIT_VIEW'], self);
            self.m_selectedSceneID = undefined;
            self.m_blocks = {};
            self.m_canvas = undefined;
            self.m_property = BB.comBroker.getService(BB.SERVICES['PROPERTIES_VIEW']).resetPropertiesView();
            self.m_scenesToolbarView = new ScenesToolbarView({el: Elements.SCENE_TOOLBAR});

            self.m_canvasScale = 1;
            self.SCALE_FACTOR = 1.2;

            pepper.injectScenePlayersIDs();
            self._initializeBlockFactory();
            self._listenAddBlockWizard();
            self._listenSceneToolbarSelected();
            self._listenZoom();
            self._listenPushToTop();
            self._listenPushToBottom();
            self._listenSceneChanged();
            self._delegateRenderAnnouncer();
        },

        /**
         Init block factory if it hasn't already been loaded
         @method _initializeBlockFactory
         **/
        _initializeBlockFactory: function () {
            var self = this;
            self.m_blockFactory = BB.comBroker.getService(BB.SERVICES['BLOCK_FACTORY']);

            if (self.m_blockFactory) {
                $(Elements.SCENE_TOOLBAR).fadeTo(500, 1);
            } else {
                BB.comBroker.listenOnce(BB.EVENTS['BLOCKS_LOADED'], function () {
                    $(Elements.SCENE_TOOLBAR).fadeTo(500, 1);
                });
                require(['BlockFactory'], function (BlockFactory) {
                    self.m_blockFactory = new BlockFactory();
                    self.m_blockFactory.loadBlockModules();
                    $('#sceneToolbar').fadeIn();
                });
            }
        },

        /**
         Init a new canvas and listen to even changes on that new canvas
         @method _initializeCanvas
         @param {Number} w width
         @param {Number} h height
         **/
        _initializeCanvas: function (w, h) {
            var self = this;

            var canvasID = BB.lib.unhash(Elements.SCENE_CANVAS);
            $(Elements.SCENE_CANVAS_CONTAINER).empty();
            $(Elements.SCENE_CANVAS_CONTAINER).append('<canvas id="' + canvasID + '" width="' + w + 'px" height="' + h + 'px"/>');
            self.m_canvas = new fabric.Canvas(canvasID);
            self.m_canvas.renderOnAddRemove = false;

            self._listenObjectChangeResetScale();
            self._listenCanvasSelections();
        },

        /**
         Init a new scene and subclass off a standard Block
         @method _initializeScene
         **/
        _initializeScene: function () {
            var self = this;
            var scene_player_data = pepper.getScenePlayerdata(self.m_selectedSceneID);
            self.m_sceneBlock = self.m_blockFactory.createBlock(self.m_selectedSceneID, scene_player_data, BB.CONSTS.PLACEMENT_IS_SCENE);
            _.extend(self.m_canvas, self.m_sceneBlock);
        },

        /**
         Listen to changes in a new scene selection
         @method _listenSceneToolbarSelected
         **/
        _listenSceneToolbarSelected: function () {
            var self = this;
            BB.comBroker.listen(BB.EVENTS.LOAD_SCENE, function (e) {
                self.m_selectedSceneID = e.edata;
                self._loadScene();
            });
        },

        /**
         Load a new scene and dispose of any previous ones
         @return {Number} Unique clientId.
         **/
        _loadScene: function () {
            var self = this;
            var domPlayerData = pepper.getScenePlayerdataDom(self.m_selectedSceneID);
            self._disposeScene();
            self._zoomReset();
            self.m_property.resetPropertiesView();
            self._initializeCanvas(600, 400);
            self._initializeScene(self.m_selectedSceneID);
            self._render(domPlayerData);
        },

        /**
         Listen to the event of scene changes which normally comes from a block that modified its data
         and re-render all scene content
         @method _listenSceneChanged
         **/
        _listenSceneChanged: function (e) {
            var self = this;

            BB.comBroker.listen(BB.EVENTS['SCENE_BLOCK_CHANGE'], function (e) {
                var blockID = e.edata, i;
                log('block edited ' + blockID);
                var domPlayerData = pepper.getScenePlayerdataDom(self.m_selectedSceneID);
                var nZooms = Math.round(Math.log(1 / self.m_canvasScale) / Math.log(1.2));
                self._zoomReset();
                self._render(domPlayerData);
                BB.comBroker.fire(BB.EVENTS.BLOCK_SELECTED, this, null, blockID);
                for (i = 0; i < self.m_canvas.getObjects().length; i++) {
                    if (blockID == self.m_canvas.item(i).getBlockData().blockID) {
                        self.m_canvas.setActiveObject(self.m_canvas.item(i));
                        break;
                    }
                }
                if (nZooms > 0) {
                    for (i = 0; i < nZooms; i++)
                        self._zoomOut();
                } else {
                    for (i = 0; i > nZooms; nZooms++)
                        self._zoomIn();
                }
                self._resetAllObjectScale();
                self.m_canvas.renderAll();
                self._announceSceneRendered();
            });
        },

        /**
         Listen to and add new component / resources to scene
         @method _listenAddBlockWizard
         @param {event} e
         **/
        _listenAddBlockWizard: function (e) {
            var self = this;
            BB.comBroker.listen(BB.EVENTS.ADD_NEW_BLOCK_SCENE, function (e) {
                var blockID = pepper.getUniqueSceneBlockID();
                var player_data = BB.PepperHelper.getBlockBoilerplate(e.edata.blockCode).getDefaultPlayerData(BB.CONSTS.PLACEMENT_SCENE, e.edata.resourceID);
                var domPlayerData = $.parseXML(player_data);
                $(domPlayerData).find('Player').attr('id', blockID);
                player_data = (new XMLSerializer()).serializeToString(domPlayerData);
                pepper.appendScenePlayerBlock(self.m_selectedSceneID, player_data);
                self._createBlock(blockID, player_data);
                e.stopImmediatePropagation();
                e.preventDefault();
            });
        },

        /**
         Listen to re-order of screen division, putting selected on top
         @method _listenPushToTop
         **/
        _listenPushToTop: function () {
            var self = this;
            $(Elements.SCENE_EDITOR_PUSH_TOP, self.$el).on('click', function () {
                var block = self.m_canvas.getActiveObject();
                if (!block)
                    return;
                self.m_canvas.bringToFront(block);
                self._updateZorder();
            });
        },

        /**
         Listen to re-order of screen division, putting selected at bottom
         @method _listenPushToBottom
         **/
        _listenPushToBottom: function () {
            var self = this;
            $(Elements.SCENE_EDITOR_PUSH_BOTTOM, self.$el).on('click', function () {
                var block = self.m_canvas.getActiveObject();
                if (!block)
                    return;
                self.m_canvas.sendToBack(block);
                self._updateZorder();
            });
        },

        /**
         Change the z-order of objects in pepper
         @method _updateZorder
         **/
        _updateZorder: function () {
            var self = this;
            var totalViews = self.m_canvas.getObjects().length;
            // var i = 0;
            // log('--------------------');
            var domSceneData = pepper.getScenePlayerdataDom(self.m_selectedSceneID);
            self.m_canvas.forEachObject(function (obj) {
                // i++;
                var blockID = obj.getBlockData().blockID;
                // log((totalViews - i) + ' ' + blockID);
                var o = $(domSceneData).find('[id="' + blockID + '"]');
                $(domSceneData).find('Players').prepend(o);
            });
            pepper.setScenePlayerData(self.m_selectedSceneID, (new XMLSerializer()).serializeToString(domSceneData));
        },

        /**
         Render the canvas thus creating all associated player blocks of the scene
         @method _render
         @param {Object} i_domPlayerData
         **/
        _render: function (i_domPlayerData) {
            var self = this;
            self.m_canvas.clear();
            self._disposeBlocks();
            log('rendering new blocks');
            $(i_domPlayerData).find('Players').find('Player').each(function (i, player) {
                var blockID = $(player).attr('id');
                var player_data = (new XMLSerializer()).serializeToString(player);
                var block = self._createBlock(blockID, player_data);
                self.m_canvas.bringToFront(block);
            });
        },

        /**
         Create a block inside a scene using it's player_data
         @method _createBlock
         @param {Number} i_blockID
         @return {Object} block
         **/
        _createBlock: function (i_blockID, i_player_data) {
            var self = this;
            var domPlayerData = $.parseXML(i_player_data);
            var layout = $(domPlayerData).find('Layout');

            var rect = new fabric.Rect({
                left: parseInt(layout.attr('x')),
                top: parseInt(layout.attr('y')),
                width: parseInt(layout.attr('width')),
                height: parseInt(layout.attr('height')),
                fill: '#ececec',
                hasRotatingPoint: false,
                borderColor: '#5d5d5d',
                stroke: 'black',
                strokeWidth: 1,
                lineWidth: 1,
                cornerColor: 'black',
                cornerSize: 5,
                lockRotation: true,
                transparentCorners: false
            });

            var block = self.m_blockFactory.createBlock(i_blockID, i_player_data, BB.CONSTS.PLACEMENT_SCENE, self.m_selectedSceneID);
            self.m_blocks[i_blockID] = block;
            _.extend(block, rect);
            // block.listenSceneSelection(self.m_canvas);
            self.m_canvas.add(block);
            return block;
        },

        /**
         Listen to canvas user selections
         @method _listenCanvasSelections
         **/
        _listenCanvasSelections: function () {
            var self = this;

            //self.m_canvas.on('object:selected', function (e) {
            //    log('object: ' + e.target.m_blockType);
            //});

            self.m_canvas.on('mouse:up', function (options) {
                var active = self.m_canvas.getActiveObject();
                var group = self.m_canvas.getActiveGroup();

                //// Group
                if (group) {
                    log('group selected');
                    var selectedGroup = options.target || group;
                    _.each(group.objects, function (selectedObject) {
                        var objectPos = {
                            x: (selectedGroup.left + (selectedObject.left)),
                            y: (selectedGroup.top + (selectedObject.top))
                        };
                        var blockID = selectedObject.getBlockData().blockID;
                        log('object: ' + selectedObject.m_blockType + ' ' + blockID);
                        self._updateBlockCords(blockID, objectPos.x, objectPos.y, selectedObject.currentWidth, selectedObject.currentHeight);
                        self._updateZorder();
                        // BB.comBroker.fire(BB.EVENTS.BLOCK_SELECTED, this, null, blockID);
                    });
                    return;
                }

                //// Object
                if (options.target || active) {
                    var selectedObject = options.target || active;
                    var blockID = selectedObject.getBlockData().blockID;
                    log('object: ' + selectedObject.m_blockType + ' ' + blockID);

                    var zoomedOut = 1 - selectedObject.scaleY;
                    self._updateBlockCords(blockID, selectedObject.left, selectedObject.top, selectedObject.currentWidth, selectedObject.currentHeight);
                    BB.comBroker.fire(BB.EVENTS.BLOCK_SELECTED, this, null, blockID);
                    self._updateZorder();
                    return;
                }

                //// Scene
                log('scene: ' + self.m_canvas.m_blockType + ' ' + self.m_selectedSceneID);
                BB.comBroker.fire(BB.EVENTS.BLOCK_SELECTED, this, null, self.m_selectedSceneID);
                // log('object ' + options.e.clientX + ' ' + options.e.clientY + ' ' + options.target.m_blockType);

            });
        },

        /**
         Update the coordinates of a block
         @method _updateBlockCords
         @param {String} i_blockID
         @param {Number} x
         @param {Number} y
         @param {Number} w
         @param {Number} h
         **/
        _updateBlockCords: function (i_blockID, x, y, w, h) {
            var self = this;
            var sy = 1 / self.m_canvasScale;
            var sx = 1 / self.m_canvasScale;
            h = h * sy;
            w = w * sx;
            x = x * sx;
            y = y * sy;
            var domPlayerData = pepper.getScenePlayerdataBlock(self.m_selectedSceneID, i_blockID);
            var layout = $(domPlayerData).find('Layout');
            layout.attr('x', parseInt(x));
            layout.attr('y', parseInt(y));
            layout.attr('width', parseInt(w));
            layout.attr('height', parseInt(h));
            var player_data = (new XMLSerializer()).serializeToString(domPlayerData);
            pepper.setScenePlayerdataBlock(self.m_selectedSceneID, i_blockID, player_data);
        },

        /**
         Reset all canvas objects to their scale is set to 1
         @method _resetAllObjectScale
         **/
        _resetAllObjectScale: function () {
            var self = this;
            _.each(self.m_canvas.getObjects(), function (obj) {
                self._resetObjectScale(obj);
            });
        },

        /**
         Reset a canvas object so its scale is set to 1
         @method _resetObjectScale
         **/
        _resetObjectScale: function (i_target) {
            var self = this;
            if (i_target.width != i_target.currentWidth || i_target.height != i_target.currentHeight) {
                i_target.width = i_target.currentWidth;
                i_target.height = i_target.currentHeight;
                i_target.scaleX = 1;
                i_target.scaleY = 1;
                self.m_canvas.renderAll();
            }

        },

        /**
         Announce to all that scene was re-rendered but do it via debounce
         @method _delegateRenderAnnouncer
         **/
        _delegateRenderAnnouncer: function () {
            var self = this;
            self._announceSceneRendered = _.debounce(function (e) {
                BB.comBroker.fire(BB.EVENTS.SCENE_BLOCKS_RENDERED, self, self.m_canvas);
                log('announcing rendering done')
            }, 200);
        },

        /**
         Listen to changes in scale so we can reset back to non-zoom on any block object
         @method _listenObjectChangeResetScale
         **/
        _listenObjectChangeResetScale: function () {
            var self = this;
            self.m_objectMovingHandler = _.debounce(function (e) {
                self._resetObjectScale(e.target);
            });
            self.m_canvas.on({
                'object:moving': self.m_objectMovingHandler,
                'object:scaling': self.m_objectMovingHandler,
                'object:selected': self.m_objectMovingHandler,
                'object:modified': self.m_objectMovingHandler
            });
        },

        /**
         Remove a Scene and cleanup after
         @method _disposeScene
         **/
        _disposeScene: function () {
            var self = this;
            if (!self.m_canvas)
                return;
            self.m_canvas.off('mouse:up');
            _.each(self.m_canvas.getObjects(), function (obj) {
                self.m_canvas.dispose(obj);
            });
            self._disposeBlocks();
            self.m_sceneBlock.deleteBlock();
        },

        /**
         Remove all block instances
         @method _disposeBlocks
         **/
        _disposeBlocks: function () {
            var self = this;
            if (!self.m_canvas)
                return;
            _.each(self.m_blocks, function (block) {
                block.deleteBlock();
            });
            self.m_blocks = {};
        },

        /**
         Listen to all zoom events via wiring the UI
         @method _listenZoom
         **/
        _listenZoom: function () {
            var self = this;
            $(Elements.SCENE_ZOOM_IN).on('click', function (e) {
                self._zoomIn();
                self._resetAllObjectScale();
            });
            $(Elements.SCENE_ZOOM_OUT).on('click', function (e) {
                self._zoomOut();
                self._resetAllObjectScale();
            });
            $(Elements.SCENE_ZOOM_RESET).on('click', function (e) {
                self._zoomReset();
                self._resetAllObjectScale();
            });
        },

        /**
         Zoom scene in
         @method _zoomIn
         **/
        _zoomIn: function () {
            var self = this;
            self.m_canvas.discardActiveGroup();
            self.m_canvasScale = self.m_canvasScale * self.SCALE_FACTOR;
            self.m_canvas.setHeight(self.m_canvas.getHeight() * self.SCALE_FACTOR);
            self.m_canvas.setWidth(self.m_canvas.getWidth() * self.SCALE_FACTOR);

            var objects = self.m_canvas.getObjects();
            for (var i in objects) {
                var scaleX = objects[i].scaleX;
                var scaleY = objects[i].scaleY;
                var left = objects[i].left;
                var top = objects[i].top;

                var tempScaleX = scaleX * self.SCALE_FACTOR;
                var tempScaleY = scaleY * self.SCALE_FACTOR;
                var tempLeft = left * self.SCALE_FACTOR;
                var tempTop = top * self.SCALE_FACTOR;

                objects[i].scaleX = tempScaleX;
                objects[i].scaleY = tempScaleY;
                objects[i].left = tempLeft;
                objects[i].top = tempTop;
                objects[i].setCoords();
            }
        },

        /**
         Zoom scene out
         @method _zoomOut
         **/
        _zoomOut: function () {
            var self = this;
            self.m_canvas.discardActiveGroup();
            self.m_canvasScale = self.m_canvasScale / self.SCALE_FACTOR;
            self.m_canvas.setHeight(self.m_canvas.getHeight() * (1 / self.SCALE_FACTOR));
            self.m_canvas.setWidth(self.m_canvas.getWidth() * (1 / self.SCALE_FACTOR));

            var objects = self.m_canvas.getObjects();
            for (var i in objects) {
                var scaleX = objects[i].scaleX;
                var scaleY = objects[i].scaleY;
                var left = objects[i].left;
                var top = objects[i].top;

                var tempScaleX = scaleX * (1 / self.SCALE_FACTOR);
                var tempScaleY = scaleY * (1 / self.SCALE_FACTOR);
                var tempLeft = left * (1 / self.SCALE_FACTOR);
                var tempTop = top * (1 / self.SCALE_FACTOR);

                objects[i].scaleX = tempScaleX;
                objects[i].scaleY = tempScaleY;
                objects[i].left = tempLeft;
                objects[i].top = tempTop;

                objects[i].setCoords();
            }
        },

        /**
         Zoom reset back to scale 1
         @method _zoomReset
         **/
        _zoomReset: function () {
            var self = this;
            if (!self.m_canvas)
                return;
            self.m_canvas.discardActiveGroup();
            self.m_canvas.setHeight(self.m_canvas.getHeight() * (1 / self.m_canvasScale));
            self.m_canvas.setWidth(self.m_canvas.getWidth() * (1 / self.m_canvasScale));

            var objects = self.m_canvas.getObjects();
            for (var i in objects) {
                var scaleX = objects[i].scaleX;
                var scaleY = objects[i].scaleY;
                var left = objects[i].left;
                var top = objects[i].top;
                var tempScaleX = scaleX * (1 / self.m_canvasScale);
                var tempScaleY = scaleY * (1 / self.m_canvasScale);
                var tempLeft = left * (1 / self.m_canvasScale);
                var tempTop = top * (1 / self.m_canvasScale);
                objects[i].scaleX = tempScaleX;
                objects[i].scaleY = tempScaleY;
                objects[i].left = tempLeft;
                objects[i].top = tempTop;
                objects[i].setCoords();
            }
            self.m_canvasScale = 1;
        }
    });

    return SceneEditorView;
});