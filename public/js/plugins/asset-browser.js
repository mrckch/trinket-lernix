$.widget('trinket.assetBrowser', {
  options : {
      assets        : []
    , libraryUrl    : []
    , uploadUrl     : ""
    , linkAddUrl    : ""
    , selectedClass : "selected"
    , templateUrl   : trinketConfig.prefix("/js/plugins/asset-browser.html")
    , eventPrefix   : "asset-browser"
    , openClass     : "open"
    , assetsHowTo   : ""
    , guest         : true
  },

  altThumbnails : {
      audio : '<i class="fa fa-file-audio-o alt-thumbnail"></i>'
    , ttf   : '<i class="fa fa-font alt-thumbnail"></i>'
    , database : '<i class="fa fa-database alt-thumbnail"></i>'
    , excel : '<i class="fa fa-file-excel-o alt-thumbnail"></i>'
    , text : '<i class="fa fa-file-text-o alt-thumbnail"></i>'
  },

  // may need to add to this list...
  altMimeTypes : {
      wav  : 'audio'
    , mp3  : 'audio'
    , ogg  : 'audio'
    , mpeg : 'audio'
    , midi : 'audio'
    , webm : 'audio'
    , db   : 'database'
    , sqlite3 : 'database'
    , xlsx : 'excel'
    , csv : 'text'
    , tsv : 'text'
    , txt : 'text'
  },

  _create : function() {
    var self = this;

    self._templates = {};

    self._haveHidden    = false;
    self._showingHidden = false;

    $.get(this.options.templateUrl).then(function(result) {
      self._setUpView(result);
    });

    this._onAppEvent("view.addimage.show", $.proxy(self.openAddImageView, self));
    this._onAppEvent("view.upload.show", $.proxy(self.openUploadImageView, self));

    // this._onAppEvent("view.add-link.show", $.proxy(self.openLinkView, self));
    this._onAppEvent("close", $.proxy(self.hide, self));

    this._onAppEvent("image.remove", $.proxy(self.removeImage, self));
    this._onAppEvent("image.replace", $.proxy(self.replaceImage, self));
    this._onAppEvent("image.restore", $.proxy(self.restoreImage, self));

    this._onAppEvent("view.hidden", $.proxy(self.viewHidden, self));

    this._dropzones = {};

    $(this.element).on('click', '[data-event]', function(event) {
      var _event  = $(this).data('event')
        , imageId = $(this).closest('ul').data('image-id');
      self.element.trigger(self.options.eventPrefix + '.' + _event, [imageId]);
    });

    if (this.options.guest) {
      $(document).on('trinket.account.success', $.proxy(self.allowImageUpload, self));
    }
  },

  _onAppEvent : function(eventName, handler, target) {
    $(target || this.element).on(this.options.eventPrefix + '.' + eventName, handler);
  },

  _setUpView : function(template) {
    var self = this
      , $view = $(template)
      , $message;

    if (this.options.lang === 'pygame' || this.options.lang === 'python3') {
      $view.find("[data-replace-text]").each(function(index, element) {
        $(element).text( $(element).data('replace-text') );
      });
    }

    $view.find(".template[template-id]").each(function(index, element) {
      var templateId = $(element).attr('template-id');
      self._templates[templateId] = $(element).detach()
                                              .removeClass('template')
                                              .removeAttr('template-id');
      self.element.empty().append($view);
    });

    this._addTemplateEvents($view);

    this._templates.addImage.on('modal.init', $.proxy(this._loadLibrary, this));

    if (this.options.assetsHowTo) {
      $message = $(this.options.assetsHowTo);
      if ($message.is('script')) {
        $message = $($message.text());
      }

      this.element.find('.howto-message').append($message);
      this.element.find('.howto-container').show();
      this._onAppEvent("view.howto.show", $.proxy(self.openHowToView, self));
      $(document).foundation();
    }

    this._viewReady     = true;
    this._dropzoneReady = false;

    this._refreshAssets();
  },

  _refreshAssets : function() {
    var self   = this
      , $list  = self.element.find('#trinket-asset-list');

    if (!this._viewReady) return;

    $('#asset-list-wrapper').show();

    if (this.options.assets.length === 0) {
      $list.hide();
    }
    else {
      $list.empty();
      $list.show();
    }

    $.each(this.options.assets, function(index, asset) {
      var $item = self._templates.imageInfo.clone();
      self._initLibraryItem($item, asset);
      $list.append($item);
    });

    self._sortList($list);

    $(document).foundation('reveal', 'reflow');
  },

  _initLibraryItem : function($item, item) {
    var self = this
      , dropdown = 'image-' + item.id
      , extensionRe = /(?:\.([^.]+))?$/
      , extension   = extensionRe.exec(item.name)[1]
      , $controls;

    this._addTemplateEvents($item);
    $item.find('.title').text(item.name);

    if (extension && self.altMimeTypes[extension]) {
      $item.find('.thumbnail').replaceWith( self.altThumbnails[ self.altMimeTypes[extension] ] );
    }
    else if (extension && self.altThumbnails[extension]) {
      $item.find('.thumbnail').replaceWith( self.altThumbnails[extension] );
    }
    else {
      $item.find('.thumbnail').attr('src', item.thumb || item.url);
    }

    $item.data('asset-id', item.id);

    $item.addClass('asset-id-' + item.id);

    $item.find('.click-for-dropzone').attr('id', 'item-dropzone-' + item.id);
    $controls = $item.find('.owner-controls');

    if (item.isDemo) {
      $item.find('.demo').show();

      // can't remove demo images
      $controls.hide()
    }
    else {
      // for dropdown menu
      $controls.attr('data-dropdown', dropdown);
      $controls.next('ul').attr('id', dropdown);

      // for control events
      $controls.next('ul').attr('data-image-id', item.id);
      $controls.closest('li.asset').attr('id', 'item-' + item.id);

      if (item.metrics && item.metrics.trinkets) {
        var badgeTitle = "Bild wird in " + item.metrics.trinkets + " ";
        badgeTitle    += item.metrics.trinkets === 1 ? "Trinket verwendet" : "Trinkets verwendet";
        $item.find('.thumbnail').after('<span class="trinket-stat"><div class="badge" title="' + badgeTitle + '">' + item.metrics.trinkets + '</div></span>');

        $controls.closest('li.asset').attr('data-used', true);
      }
    }

    this._onAppEvent('assets.remove', function() {
      $item.find('.controls').hide();
      $item.find('.confirm-controls').show();
    }, $item);

    this._onAppEvent('assets.confirm', function() {
      $.each(self.options.assets, function(index, asset) {
        if (asset.id === item.id) {
          self.options.assets.splice(index, 1);
          self._refreshAssets();
          self.element.trigger('assets.change');
          return false;
        }
      });
    }, $item);

    this._onAppEvent('assets.cancel', function() {
      $item.find('.confirm-controls').hide();
      $item.find('.controls').show();
    }, $item);

    this._onAppEvent('assets.toggle', function() {
      if ($item.hasClass(self.options.selectedClass)) {
        $item.removeClass(self.options.selectedClass);
        $.each(self.options.assets, function(index, asset) {
          if (asset.id === item.id) {
            self.options.assets.splice(index, 1);
            self._refreshAssets();
            self.element.trigger('assets.change');

            if (!$item.attr('data-used')) {
              $item.find('.if-not-used').removeClass('hide');
            }

            return false;
          }
        });
      }
      else {
        $item.addClass(self.options.selectedClass);
        self._addToAssets(item);
        $item.find('.if-not-used').addClass('hide');
      }
    }, $item);
  },

  _addTemplateEvents : function($template) {
    var self = this;
    $template.find("[events]").each(function(index, element) {
      var events = $(element).attr("events").split(/\s*,\s*/)
        , mapping, i;

      $(element).off();

      for (i = events.length; --i >= 0;) {
        mapping = events[i].split(/\s*:\s*/);
        $(element).on(mapping[0], function(e) {
          $(this).trigger(self.options.eventPrefix + "." + mapping[1], {
            originalEvent : e
          });
        });
      }
    });

    return $template;
  },

  _initUpload : function() {
    var self = this
      , acceptedFiles = this.options.acceptedFiles || "image/jpeg,image/png,image/gif,image/jpg";

    new Dropzone(self._templates.addImage.find('.dropzone')[0], {
        url : "/api/users/assets"
      , acceptedFiles : acceptedFiles
      , dictDefaultMessage : ""
      , clickable : "#select-to-upload"
      , previewsContainer : "#preview-container"
      , init: function() {
          this.on("success", function(file, response) {
            // add metrics on initial upload
            response.file.metrics = {
              trinkets : 1
            };

            self._addToLibrary(response.file, 'top');
            self._addToAssets(response.file);
          });
        }
    });

    self._onAppEvent("view.upload.hide", $.proxy(self.closeUploadImageView, self));

    self._dropzoneReady = true;
  },

  _markSelected : function() {
    var self = this
      , usedAssets = {}
      , i;

    for (i = 0; i < self.options.assets.length; i++) {
      usedAssets[self.options.assets[i].id] = self.options.assets[i];
    }

    this._templates.addImage.find('.asset').each(function(index) {
      var $item = $(this);
      $item.removeClass(self.options.selectedClass);
      if (usedAssets[$item.data('asset-id')]) {
        $item.addClass(self.options.selectedClass);
      }
    });
  },

  _addToAssets : function(item) {
    this.options.assets.push({
      url    : item.url
      , name : item.name
      , id   : item.id
    });
    this.element.trigger('assets.change');
  },

  _addToLibrary : function(item, loc) {
    var $modal = this._templates.addImage
      , $list  = item.hidden ? $modal.find('ul#hidden-asset-list') : $modal.find('ul#my-asset-list')
      , $item  = this._templates.libraryImageInfo.clone();

    if (item.hidden) {
      $item.find('.if-hidden').removeClass('hide');
    }
    else {
      $item.find('.if-not-hidden').removeClass('hide');
    }

    if (item.metrics && item.metrics.trinkets) {
      $item.find('.if-not-used').addClass('hide');
    }

    loc = loc || "";

    this._initLibraryItem($item, item);

    if (loc === 'top') {
      $list.prepend($item);
      $item.addClass(this.options.selectedClass);
    }
    else {
      $list.append($item);
    }

    if (!item.hidden) {
      $item.addClass("clickable");
    }

    $(document).foundation('dropdown', 'reflow');

    return $item;
  },

  _loadLibrary : function() {
    var self = this
      , $modal = this._templates.addImage
      , $list  = $modal.find('ul#my-asset-list');

    this._addTemplateEvents(this._templates.addImage);

    $list.empty();
    $('#loadingContents').show();

    $.get(self.options.libraryUrl).then(function(result) {
      var items = result.files || []
        , i;

      for (i = 0; i < items.length; i++) {
        self._addToLibrary(items[i]);

        if (!self._haveHidden && items[i].hidden) {
          self.element.find('.have-hidden').removeClass('hide');
          self._haveHidden = true;
        }
      }

      $(document).foundation('dropdown', 'reflow');

      self._markSelected();
      self._templates.addImage.on('modal.show', $.proxy(self._markSelected, self));
      self._templates.addImage.on('modal.hide', $.proxy(self._refreshAssets, self));

      $('#loadingContent').hide();
    });
  },

  _showModal : function($modal) {
    var self = this;
    if (this._modal) {
      this._modal.hide();
      this._modal.trigger('modal.hide');
    }

    if (!$.contains(document, $modal[0])) {
      $('#asset-viewer-contents').append($modal);
      $modal.trigger('modal.init');
      $modal.find('.closer, .addimage-done').click(function() {
        if (self._modal) {
          self._modal.trigger('modal.hide');
          self._modal.hide();
          self._modal = undefined;
        }
      });
    }

    this._modal = $modal;
    this._modal.show();
    this._modal.trigger('modal.show');
  },

  assets : function(value) {
    if (value !== undefined) {
      if (Array.isArray(value)) {
        this.options.assets = value;
        this._refreshAssets();
      }
      else {
        throw new Error('trinket.codeEditor.assets expects an array, but got ' + value);
      }
    }
    
    return this.options.assets;
  },

  show : function() {
    this.element.addClass(this.options.openClass);
  },

  hide : function() {
    this.element.removeClass(this.options.openClass);
  },

  openUploadImageView : function() {
    var self = this;
    if (self.options.guest) {
      $('#upload-guest').fadeIn();
      $('#assetLogin').click(function(el) {
        self.element.trigger('trinket.account.login', ['#assetAccount', { action : $(el.target).data('action') }]);
      });
      /*
      $('#assetCreateAccount').click(function(el) {
        self.element.trigger('trinket.account.create', ['#assetAccount', { action : $(el.target).data('action') }]);
      });
      */
    }
    else {
      $('#upload-assets').fadeIn(function() {
        if (!self._dropzoneReady) {
          self._initUpload();
        }
      });
    }

    $(document).foundation('dropdown', 'reflow');
  },

  openAddImageView : function() {
    $('#asset-list-wrapper').hide();
    this._showModal(this._templates.addImage);
  },

  closeUploadImageView : function() {
    $('#upload-assets').fadeOut({
      complete : function() {
        $(document).foundation('dropdown', 'reflow');
      }
    });
  },

  openHowToView : function() {
    $('#howto-message').show();
  },

  allowImageUpload : function() {
    this.options.guest = false;

    $('#upload-guest').hide();
    this._loadLibrary();
    this.openUploadImageView();
  },

  openLinkView : function() {
    this._showModal(this._templates.imageLink);
  },

  removeImage : function(event, imageId) {
    var self = this
      , $item, $hiddenList;

    $.ajax({
        url    : '/api/users/assets/' + imageId
      , method : 'DELETE'
    })
    .done(function(result) {
      $item = self.element.find('#item-' + imageId);
      $hiddenList = self.element.find('#hidden-asset-list');

      $item.fadeOut({
        complete : function() {
          $hiddenList.append( $item.detach() );

          self._sortList($hiddenList);

          if (!self._haveHidden) {
            self.element.find('.have-hidden').fadeIn();
          }

          // swap dropdown options
          $item.find('.if-hidden').removeClass('hide');
          $item.find('.if-not-hidden').addClass('hide');

          $item.fadeIn();
        }
      });
    });
  },

  replaceImage : function(event, imageId) {
    var self  = this
      , $item = self.element.find('#item-' + imageId)
      , used  = $item.attr('data-used') || false;

    if (!self._dropzones[imageId]) {
      self._dropzones[imageId] = new Dropzone('#item-' + imageId, {
          url                : '/api/users/assets/' + imageId
        , acceptedFiles      : 'image/jpeg,image/png,image/gif,image/jpg'
        , dictDefaultMessage : ''
        , clickable          : '#item-dropzone-' + imageId
        , previewsContainer  : '.hidden-previews'
        , maxFiles           : 1
        , init: function() {
            this.on('success', function(file, response) {
              // consider keeping the original name
              $item.find('.title').text(response.file.name);
              $item.find('.thumbnail').attr('src', response.file.url);

              for (var i = 0; i < self.options.assets.length; i++) {
                if (self.options.assets[i].id === imageId) {
                  self.options.assets[i].url  = response.file.url;
                  self.options.assets[i].name = response.file.name;
                }
              }

              self.element.trigger('assets.change');

              $(document).foundation('dropdown', 'reflow');
            });
            this.on("maxfilesexceeded", function(file) {
              try {
                this.removeAllFiles();
              } catch(e) { }

              this.addFile(file);
            });
            this.on("uploadprogress", function(file, progress, bytesSent) {
              if (!self.element.find('li#item-' + imageId).has('.upload-progress').length) {
                var $progress = self.element.find('.upload-progress').clone();
                self.element.find('li#item-' + imageId).find('.asset-container').append($progress);
              }

              var $uploadProgress = self.element.find('li#item-' + imageId).find('.upload-progress');

              $uploadProgress.removeClass('hide');
              $uploadProgress.find('span.meter').css('width', progress + '%');
              $uploadProgress.find('p.percent').text(Math.floor(progress) + '%');

              if (progress === 100) {
                $uploadProgress.fadeOut(3000, function() {
                  $uploadProgress.remove();
                });
              }
            });
          }
      });
    }

    if (!used) {
      this.element.find('#item-dropzone-' + imageId).trigger('click');
    }
  },

  viewHidden : function() {
    var $hiddenList = this.element.find('#hidden-asset-list');

    $hiddenList.prev('a').fadeOut({
      complete : function() {
        $hiddenList.fadeIn();
      }
    });
  },

  restoreImage : function(event, imageId) {
    var self = this
      , $item, $trinketList;

    $.post('/api/users/assets/restore', {
      fileId : imageId
    })
    .done(function(result) {
      $item = self.element.find('#item-' + imageId);
      $libraryList = self.element.find('#my-asset-list');

      $item.fadeOut({
        complete : function() {
          $libraryList.append( $item.detach() );

          self._sortList($libraryList);

          // swap dropdown options
          $item.find('.if-hidden').addClass('hide');
          $item.find('.if-not-hidden').removeClass('hide');

          $item.fadeIn();

          $(document).foundation('dropdown', 'reflow');
        }
      });
    });
  },

  _sortList : function($list) {
    var $li     = $list.find('li.asset')
      , $listLi = $($li, $list).get();

    $listLi.sort(function(a, b) {
      var keyA = $(a).text().toUpperCase();
      var keyB = $(b).text().toUpperCase();

      return (keyA < keyB) ? -1 : 1;
    });

    $.each($listLi, function(index, row) {
      $list.append(row);
    });

    $(document).foundation('dropdown', 'reflow');
  }
});
