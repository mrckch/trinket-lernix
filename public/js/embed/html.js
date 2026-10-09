(function(window, TrinketIO) {
var api;
var modifiedOnce = false;
var editor;
var start;
var runMode_icon_classes = {
  run     : 'fa fa-play',
  autorun : 'fa fa-repeat'
};
var runMode_labels = {
  run     : 'Ausführen',
  autorun : 'Autorun'
};

var mainFile = "index.html";

/**
 * Escape special regex characters in a string
 */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Inline CSS and JS files into the HTML document.
 * Replaces <link href="file.css"> with <style>...contents...</style>
 * Replaces <script src="file.js"></script> with <script>...contents...</script>
 * Preserves order to maintain CSS cascade.
 */
function inlineLocalFiles(html, files) {
  // Inline CSS: <link rel="stylesheet" href="style.css"> or <link href="style.css" rel="stylesheet">
  html = html.replace(/<link\s+[^>]*href=["']([^"']+\.css)["'][^>]*>/gi, function(match, href) {
    // Check if this is actually a stylesheet link
    if (!/rel\s*=\s*["']stylesheet["']/i.test(match) && !/type\s*=\s*["']text\/css["']/i.test(match)) {
      // If no rel="stylesheet", check if it looks like a stylesheet anyway (has .css)
      if (!/\.css$/i.test(href)) {
        return match;
      }
    }
    if (files[href]) {
      return '<style>' + files[href] + '</style>';
    }
    return match;
  });

  // Inline JS: <script src="app.js"></script>
  html = html.replace(/<script\s+[^>]*src=["']([^"']+\.js)["'][^>]*><\/script>/gi, function(match, src) {
    if (files[src]) {
      return '<script>' + files[src] + '</script>';
    }
    return match;
  });

  return html;
}

/**
 * Rewrite asset URLs (images, etc.) to their absolute URLs
 */
function rewriteAssetUrls(html, assetMap) {
  for (var assetName in assetMap) {
    // Replace src="asset.png" or href="asset.png" with absolute URL
    var regex = new RegExp('(src|href)\\s*=\\s*["\']' + escapeRegex(assetName) + '["\']', 'gi');
    html = html.replace(regex, '$1="' + assetMap[assetName] + '"');
  }
  return html;
}

/**
 * Build the complete HTML document for local sandbox mode
 */
function buildLocalDocument(files, assetMap, outputPage) {
  var html = files[outputPage] || files['index.html'] || '';

  // Inline local CSS and JS files
  html = inlineLocalFiles(html, files);

  // Rewrite asset URLs to absolute paths
  html = rewriteAssetUrls(html, assetMap);

  return html;
}

/**
 * Run code using local sandboxed iframe (srcdoc)
 */
function runCodeLocal(files, assetMap, outputPage) {
  var html = buildLocalDocument(files, assetMap, outputPage);

  // Use srcdoc for sandboxed rendering
  $('#htmlOutput').attr('srcdoc', html);

  setTimeout(function() {
    $('#html-run-icon').removeClass().addClass(runMode_icon_classes[api.runMode]);
    window.readyForSnapshot = true;
  }, 350);

  $('#errorConnecting').addClass('hide');
}

/**
 * Run code using external sandbox server
 */
function runCodeExternal(files, assetMap, outputPage) {
  var sandboxUrl = trinketSandboxConfig.protocol + '://' + trinketSandboxConfig.subdomain + trinketSandboxConfig.domain + '/';

  $.post(sandboxUrl, {files: files, assets: assetMap})
    .done(function(data, status) {
      if (status === "success") {
        var activeTab = editor.activeTab();
        if (activeTab && /\.html$/.test(activeTab.fileName)) {
          outputPage = activeTab.fileName;
        }

        $('#htmlOutput').attr('src', sandboxUrl + data.token + "/" + outputPage);
      }
      $('#errorConnecting').addClass('hide');
    }).fail(function(err) {
      $('#errorConnecting').removeClass('hide');
    }).always(function() {
      setTimeout(function() {
        $('#html-run-icon').removeClass().addClass(runMode_icon_classes[api.runMode]);
      }, 350);

      window.readyForSnapshot = true;
    });
}

function runCode() {
  $('.reveal-modal').foundation('reveal', 'close');

  var prog       = api.getValue()
    , files      = editor.getAllFiles()
    , assets     = editor.assets()
    , outputPage = mainFile
    , assetMap   = {};

  for (var i = 0; i < assets.length; i++) {
    assetMap[assets[i].name] = assets[i].url;
  }

  // Determine output page from active tab
  var activeTab = editor.activeTab();
  if (activeTab && /\.html$/.test(activeTab.fileName)) {
    outputPage = activeTab.fileName;
  }

  $('#html-run-icon').removeClass().addClass('fa fa-circle-o-notch fa-spin');

  // Choose rendering mode based on configuration
  if (trinketSandboxConfig.mode === 'local') {
    runCodeLocal(files, assetMap, outputPage);
  } else {
    runCodeExternal(files, assetMap, outputPage);
  }

  if (!modifiedOnce && api.isModified()) {
    api.updateMetric('runs', prog);
    api.sendAnalytics('Interaction', {
      action   : 'Modify',
      label    : 'Code'
    });
    modifiedOnce = true;
  }
}

window.TrinketAPI = {
  initialize : function(trinket) {
    api   = this;
    start = $('#start-value').val();
    api.runMode = 'autorun';
    if ($('#runMode-value').val() && typeof runMode_labels[ $('#runMode-value').val() ] !== 'undefined') {
      api.runMode = $('#runMode-value').val();
    }

    var uiType = api.getUIType();

    editor = $('#editor').codeEditor({
        showTabs         : !(trinket.displayOnly || this._queryString.outputOnly)
      , noEditor         : !!(trinket.displayOnly || this._queryString.outputOnly)
      , mainFileName     : mainFile
      , defaultFileExt   : "html"
      , value            : trinket.code
      , assets           : (window.trinket && window.trinket.config && window.trinket.config.assetsEnabled) ? (trinket.assets ? trinket.assets.slice() : []) : false
      , assetsHowTo      : (window.trinket && window.trinket.config && window.trinket.config.assetsEnabled) ? '#assets-howto-message' : ''
      , guest            : uiType === 'guest' ? true : false
      , owner            : uiType === 'owner' ? true : false
      , canHideTabs      : api.hasPermission('hide-trinket-files')

        // TODO: must also be owner of this trinket - eventually convert to actual permissions based check on trinket
      , canAddInlineComments : api.hasPermission('add-trinket-inline-comments') && (uiType === 'owner' || api.assignmentFeedback)
      , assignmentViewOnly   : api.assignmentViewOnly
      , userId               : api.getUserId()
      , disableAceEditor     : window.userSettings && window.userSettings.disableAceEditor || false
      , tabSize              : window.userSettings && window.userSettings.htmlTab || 2
      , lineWrapping         : window.userSettings && window.userSettings.lineWrapping || false
    }).data('trinket-codeEditor');

    $(document).on('trinket.code.edit',    $.proxy(this.showCode, this));
    $(document).on('trinket.code.run',     $.proxy(this.showResult, this));
    $(document).on('trinket.code.autorun', $.proxy(this.showResult, this));

    $(document).on('trinket.output.view',       $.proxy(api.showOutput, api));
    $(document).on('trinket.instructions.view', $.proxy(api.showInstructions, api));

    $('#editorToggleWrapper').keydown($.proxy(this.editorToggleFieldset, this));
    $('#toolbarEditorToggle').change($.proxy(this.toolbarEditorToggle, this));

    $('.menu-toolbar .menu-button[data-action="code.run"]').on('mousedown', function(event) {
      if (editor && editor.isFocused()) {
        event.preventDefault();
      }
    });

    api.reset(trinket);

    if (!api._queryString.outputOnly) {
      var autorunFunc = _.debounce(function() {
        api.triggerChange();
        if (api.runMode === 'autorun') {
          runCode();
        }
      }, 750);

      editor.change(autorunFunc);
      $(document).on('assets.change', autorunFunc);
    }

    // run code on tab change
    editor.element.on('codeeditor.tabChanged', function(event) {
      if (api.runMode === 'autorun') {
        runCode();
      }
    });

    $(document).on('open.fndtn.alert', function() {
      editor.resize();
    });

    $(document).on('close.fndtn.alert', function() {
      editor.resize();
    });

    api.draggable();

    if (api._queryString && api._trinket.description && api._queryString.showInstructions && api._trinket.description.length) {
      $(document).trigger('trinket.instructions.view');
    }
  },
  getType : function() {
    return 'html';
  },
  getValue : function(opts) {
    return editor.serialize(opts);
  },
  getMainFile : function() {
    return mainFile;
  },
  getAnalyticsCategory : function() {
    return 'HTML';
  },
  serialize : function(opts) {
    var serialized = {
      code     : this.getValue(opts),
      assets   : editor.assets().slice(),
      settings : this._trinket.settings
    };

    if (opts && opts.removeComments) {
      editor.removeComments();
    }

    return serialized;
  },
  showCode : function(event) {
    $('#codeOutput').addClass('hide');
    $('#editor').removeClass('hide');
  },
  showResult : function(event) {
    if (event && $(event.target).data('button')) {
      if ($(event.target).data('button') !== api.runMode) {
        api.runMode = $(event.target).data('button');
        api.triggerRunModeChange();
        api.changeRunOption(api.runMode);
      }
    }

    $('#codeOutput').removeClass('hide');
    $('#editor').addClass('hide');

    $('#instructionsContainer').addClass('hide');
    $('#outputContainer').removeClass('hide');

    $('#codeOutputTab').addClass('active');
    $('#instructionsTab').removeClass('active');

    runCode();
    if (event) {
      api.sendAnalytics('Interaction', {
        action   : 'Click',
        label    : 'Run'
      });
    }
  },
  reset : function(trinket) {
    editor.reset(trinket.code);
    editor.assets(trinket.assets ? trinket.assets.slice() : []);
    if (trinket.code && (start === 'result' || this.runMode === 'autorun')) {
      this.showResult();
    }
    else {
      this.showCode();
    }
  },
  focus : function() {
    if (!$('body').data('is-mobile') && $('body').data('autofocus')) {
      editor.focus();
    }
  },
  isDirty : function() {
    if (!this._trinket) return false;

    if (this.getValue() !== (this._original.code || '')) {
      return true;
    }

    var editorAssets = editor.assets();
    if (editorAssets.length !== (this._original.assets || []).length) {
      return true;
    }

    if (JSON.stringify(editorAssets) !== JSON.stringify(this._original.assets)) {
      return true;
    }

    return false;
  },
  downloadable : function() {
    var owner = this.getUIType() === 'owner'
      , remix;

    if (this._trinket && this._trinket._origin_id) {
      remix = this._trinket._origin_id;
    }

    return {
      files  : owner && !remix ? editor.getAllFiles() : editor.getAllVisibleFiles(),
      assets : editor.assets()
    };
  },

  setWrap: function(wrap) {
    editor.setWrap(wrap)
    this.setAPILineWrap(wrap)
  },

  setIndent: function(indent) {
    editor.setIndent(indent);
    this.setAPIIndent(undefined, indent, undefined, undefined);
  },

  changeRunOption : function(option) {
    $('.run-it').data('action', 'code.' + option);
    $('.run-it').find('i').removeClass().addClass( runMode_icon_classes[option] );
    $('.run-it').find('label').text( runMode_labels[option] );
  },

  toolbarEditorToggle : function(event) {
    if ($(event.target).is(':checked')) {
      editor.option('disableAceEditor', true);
    }
    else {
      editor.option('disableAceEditor', false);
    }
    editor.refresh();
  },
  editorToggleFieldset : function(event) {
    var keycode = (event.keyCode ? event.keyCode : event.which);
    if (event.target.id === 'editorToggleFieldset' && keycode === 32) {
      $('#toolbarEditorToggle').prop('checked', !$('#toolbarEditorToggle').is(':checked'));
      if ($('#toolbarEditorToggle').is(':checked')) {
        editor.option('disableAceEditor', true);
      }
      else {
        editor.option('disableAceEditor', false);
      }
      editor.refresh();
    }
  }
};

})(window, window.TrinketIO);
