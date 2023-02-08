/* global google,gapi */
import { getLanguage } from "../lang";
import { observer as globalObserver } from "../utils/observer";
import { translate, errLogger, loadExternalScript } from "../utils/tools";
import GD_CONFIG from "../../botPage/common/google_drive_config";
import { load } from "../../botPage/view/blockly";
import { TrackJSError } from "../../botPage/view/logger";
import store from "../../botPage/view/deriv/store";
import { setGdReady } from "../../botPage/view/deriv/store/ui-slice";
import { setGdLoggedIn } from "../../botPage/view/deriv/store/client-slice";
import decodeJwtResponse from "jwt-decode";

const getPickerLanguage = () => {
  const language = getLanguage();

  if (language === "zhTw") return "zh-TW";
  if (language === "zhCn") return "zh-CN";

  return language;
};
// [TODO]: Refactor to a function or improve it by TS
class GoogleDriveUtil {
  constructor(
    client_id = GD_CONFIG.CLIENT_ID,
    api_key = GD_CONFIG.API_KEY,
    app_id = GD_CONFIG.APP_ID,
    api_url_identity = GD_CONFIG.API_URL_IDENTITY,
    api_url_gdrive = GD_CONFIG.API_URL_GDRIVE,
    auth_scope = GD_CONFIG.AUTH_SCOPE,
    scope = GD_CONFIG.SCOPE,
    discovery_docs = GD_CONFIG.DISCOVERY_DOCS,
    bot_folder = `Binary Bot - ${translate("Strategies")}`
  ) {
    this.client_id = client_id;
    this.api_key = api_key;
    this.app_id = app_id;
    this.api_url_identity = api_url_identity;
    this.api_url_gdrive = api_url_gdrive;
    this.auth_scope = auth_scope;
    this.scope = scope;
    this.discovery_docs = discovery_docs;
    this.bot_folder = bot_folder;
    this.auth = null;
    this.is_authorized = false;
    this.profile = null;
    // Fetch Google API script and initialize class fields
    // Fetch Google API script and initialize class fields
    loadExternalScript(this.api_url_identity)
      .then(() => {
        store.dispatch(setGdReady(true));
        this.initUrlIdentity()
      })
      .catch((err) =>
        errLogger(
          err,
          translate("There was an error loading Google Identity API script.")
        )
      );
    loadExternalScript(this.api_url_gdrive)
      .then(() => {
        gapi.load('client:picker', async () => {
          await gapi.client.load('https://www.googleapis.com/discovery/v1/apis/drive/v3/rest');
        });
      })
      .catch((err) =>
        errLogger(
          err,
          translate("There was an error loading Google Drive API script.")
        )
      );
  }

  get clientEmail() {
    return this.profile?.email;
  };

  handleCredentialResponse = (response) => {
    const response_payload = decodeJwtResponse(response.credential);
    this.profile = response_payload;
    this.updateLoginStatus(true);
    store.dispatch(setGdLoggedIn(true));
    this.is_authorized = true;
  };

  initUrlIdentity = () => {
    this.client = google.accounts.oauth2.initTokenClient({
      client_id: GD_CONFIG.CLIENT_ID,
      scope: GD_CONFIG.SCOPE,
      callback: (tokenResponse) => {
        this.updateLoginStatus(true);
        store.dispatch(setGdReady(true));
        this.access_token = tokenResponse.access_token;
        store.dispatch(setGdLoggedIn(true));
      },
    });
    store.dispatch(setGdReady(true));
    google.accounts.id.initialize({
      client_id: GD_CONFIG.CLIENT_ID,
      callback: (response) => this.handleCredentialResponse(response),
      auto_select: true,
      prompt_parent_id: "g_id_onload"
    });

    google.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        // TODO handle in case needed
      }
  });
  };

  login = () => {
    this.client.callback = (response) => {
      store.dispatch(setGdReady(true));
      this.access_token = response.access_token;
      store.dispatch(setGdLoggedIn(true));
      google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          // TODO handle incase needed
        }
    });
    }
    this.client.requestAccessToken()

    
  }
  //!TODO should be removed after finding mothod for get token Google identity
  initGDrive = () => {
    this.client = google.accounts.oauth2.initTokenClient({
      client_id: GD_CONFIG.CLIENT_ID,
      scope: GD_CONFIG.SCOPE,
      callback: async   (tokenResponse) => {
        this.updateLoginStatus(true);
        store.dispatch(setGdReady(true));
        this.access_token = tokenResponse.access_token;

        store.dispatch(setGdLoggedIn(true));
      },
    });
  };

  updateLoginStatus(is_logged_in) {
    store.dispatch(setGdLoggedIn(is_logged_in));
    this.is_authorized = is_logged_in;
  }

  logout() {
    google.accounts.id.revoke(this.profile?.email, done => {
    this.updateLoginStatus(false);
  })
}

  createFilePickerView({
    title,
    afterAuthCallback,
    mime_type,
    pickerCallback,
    generalCallback,
    rejectCallback,
  }) {
    afterAuthCallback()
      .then(() => {
        const view = new google.picker.DocsView();
        view
          .setIncludeFolders(true)
          .setSelectFolderEnabled(true)
          .setMimeTypes(mime_type);

        const picker = new google.picker.PickerBuilder();
        picker
          .setOrigin(`${window.location.protocol}//${window.location.host}`)
          .setTitle(translate(title))
          .addView(view)
          .setLocale(getPickerLanguage())
          .setAppId(this.app_id)
          .setOAuthToken(this.access_token)
          .setDeveloperKey(this.api_key)
          .setCallback(pickerCallback)
          .build()
          .setVisible(true);
        if (typeof generalCallback === "function") generalCallback();
      })
      .catch(rejectCallback);
  }

  createFilePicker() {
    return new Promise((resolve, reject) => {
      // eslint-disable-next-line consistent-return
      const userPickedFile = (data) => {
        if (data.action === google.picker.Action.PICKED) {
          const file_id = data.docs[0].id;

          gapi.client.drive.files
            .get({
              alt: "media",
              fileId: file_id,
              mimeType: "text/plain",
            })
            .then((response) => {
              try {
                load(response.body);
              } catch (err) {
                const error = new TrackJSError(
                  "GoogleDrive",
                  translate("Unrecognized file format"),
                  err
                );
                globalObserver.emit("Error", error);
                reject(error);
              }
            })
            .catch((err) => {
              if (err.status && err.status === 401) this.logout();

              const error = new TrackJSError(
                "GoogleDrive",
                translate(
                  "There was an error retrieving data from Google Drive"
                ),
                err
              );

              globalObserver.emit("Error", error);
              reject(error);
            });
        } else if (data.action === google.picker.Action.CANCEL) reject();
      };

      this.createFilePickerView({
        title: translate("Select a Binary Bot strategy"),
        afterAuthCallback: gapi.client.drive.files.list,
        mime_type: ["text/xml", "application/xml"],
        pickerCallback: userPickedFile,
        generalCallback: resolve,
        rejectCallback: (err) => {
          if (err.status && err.status === 401) this.logout();

          const error = new TrackJSError(
            "GoogleDrive",
            translate("There was an error listing files from Google Drive"),
            err
          );
          globalObserver.emit("Error", error);
          reject(error);
        },
        generalRejectCallback: reject,
      });
    });
  }

  getDefaultFolderId() {
    return new Promise((resolve, reject) => {
      // Avoid duplicate auth flow by checking if user is already authed

      // eslint-disable-next-line
      gapi.client.drive.files.list({ q: "trashed=false" }).then((response) => {
        const folder = response.result.files.find(
          (file) => file.mimeType === "application/vnd.google-apps.folder"
        );

        if (folder) return resolve();

        gapi.client.drive.files
          .create({
            resource: {
              name: this.bot_folder,
              mimeType: "application/vnd.google-apps.folder",
              fields: "id",
            },
          })
          .then(resolve)
          .catch((err) => {
            if (err?.status === 401) this.logout();

            const error = new TrackJSError(
              "GoogleDrive",
              translate(
                "There was an error retrieving files from Google Drive"
              ),
              err
            );
            globalObserver.emit("Error", error);
            reject(error);
          });
      });
    });
  }

  requestAccessToken() {
    if(!this.access_token)
    this.client.requestAccessToken({ prompt: "" });
  }
  saveFile(options) {
    return new Promise((resolve, reject) => {
      // eslint-disable-next-line consistent-return
      const savePickerCallback = (data) => {
        if (data.action === google.picker.Action.PICKED) {
          const folder_id = data.docs[0].id;
          const strategy_file = new Blob([options.content], {
            type: options.mimeType,
          });
          const strategy_file_metadata = JSON.stringify({
            name: options.name,
            mimeType: options.mimeType,
            parents: [folder_id],
          });

          const form_data = new FormData();
          form_data.append(
            "metadata",
            new Blob([strategy_file_metadata], { type: "application/json" })
          );
          form_data.append("file", strategy_file);

          const xhr = new XMLHttpRequest();
          xhr.responseType = "json";
          xhr.open(
            "POST",
            "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart"
          );
          xhr.setRequestHeader("Authorization", `Bearer ${this.access_token}`);
          xhr.onload = () => {
            if (xhr.status === 200) {
              resolve();
              return;
            }
            if (xhr.status === 401) this.logout();
            const error = new TrackJSError(
              "GoogleDrive",
              translate("There was an error processing your request"),
              xhr
            );
            globalObserver.emit("Error", error);
            reject(error);
          };
          xhr.send(form_data);
          return;
        }
        if (data.action === google.picker.Action.CANCEL) reject();
      };

      this.createFilePickerView({
        title: translate("Select a folder"),
        afterAuthCallback: this.getDefaultFolderId.bind(this),
        mime_type: "application/vnd.google-apps.folder",
        pickerCallback: savePickerCallback,
        rejectCallback: reject,
        generalRejectCallback: reject,
      });
    });
  }
}

const google_drive_util = new GoogleDriveUtil();

export default google_drive_util;
