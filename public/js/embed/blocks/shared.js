(function(window, TrinketIO) {
  "use strict";

  TrinketIO.export('blocks.shared', function(api) {

    $('#blocks-upload').fileReaderJS({
      accept : false,
      readAsDefault : 'Text',
      on : {
        load : function(e, file) {
          var xml_text, tmp_workspace;

          api.resetUpload();

          xml_text = e.target.result;
          $('#blocks-upload-filename').text(file.name);

          try {
            api.upload_xml = Blockly.Xml.textToDom(xml_text);

            // test uploaded xml
            tmp_workspace = new Blockly.Workspace();

            // deprecated call warning?
            Blockly.Xml.domToWorkspace(api.upload_xml, tmp_workspace);

            $('.blocks-button').removeClass('disabled');

          } catch(e) {
            console.log("e:", e);

            api.upload_xml = "";
            $('.blocks-button').addClass('disabled');

            $('#uploadMessage').html('<i class="fa fa-exclamation-circle alert"></i> Beim Hochladen deiner Datei ist ein Fehler aufgetreten. Prüfe, ob es eine gültige XML-Datei ist, und versuche es noch einmal.');
            $('#uploadMessage').removeClass('hide');
          }
        }
      }
    });

    /***
    / * comment out for now - too many non-fatal messages which prevent valid blocks files from being uploaded
    / * the check above prevents truly non-valid files from being accepted
    window.addEventListener('message', function(e) {
      var data;

      try {
        data = JSON.parse(e.data);
      } catch(e) {}

      // TODO? add support for Blockly.error
      if (data && data["Blockly.warn"] && api.upload_modal_open) {
        api.upload_xml = "";
        $('.blocks-button').addClass('disabled');

        if ($('#uploadMessage').is(':empty')) {
          $('#uploadMessage').html('<i class="fa fa-exclamation-circle alert"></i> We had a problem uploading your file. Please check that your file is properly formatted XML and try again.');
        }

        if ($('#blockly-warnings').length) {
          $('#blockly-warnings').append('<li>' + data["Blockly.warn"] + '</li>');
        }
        else {
          $('#uploadMessage').append('<ul id="blockly-warnings"><li>' + data["Blockly.warn"] + '</li></ul>');
        }

        $('#uploadMessage').removeClass('hide');
      }
    });
    */

  });
})(window, window.TrinketIO);
