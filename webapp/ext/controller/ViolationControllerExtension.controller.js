sap.ui.define([
    "sap/ui/core/mvc/ControllerExtension",
    "sap/ui/core/Element",
    "sap/ui/model/json/JSONModel"
], function (ControllerExtension, Element, JSONModel) {
    "use strict";

    return ControllerExtension.extend("com.jhah.zhrjhahsectvs.ext.controller.ViolationControllerExtension", {

        _sLatestRequestedId: null,
        _oJhahIdBinding: null,
        _countdownInterval: null,

        // ========================================================================
        // STATE
        // ========================================================================
        _pEditingStatusReset: null,
        _requirementUIInterval: null,

        _bIsDraft: false,
        _bDraftStateKnown: false,

        _bIsMine: false,
        _bOwnershipKnown: false,

        _lastAttachmentDebugSignature: null,
        _lastLoggedUIState: null,

        _log: function (sMessage, oData) {
            var sPrefix = "[JHAH-TVS] ";
            if (oData !== undefined) console.info(sPrefix + sMessage, oData);
            else console.info(sPrefix + sMessage);
        },

        // ========================================================================
        // 1. ROLE & TAB AUTHORIZATIONS
        // ========================================================================

        _applyTabAuthorizations: function (sMode) {
            var oView = this.base.getView();
            if (!oView) return;

            var aTabs = oView.findAggregatedObjects(true, function (o) {
                return o.isA("sap.m.IconTabFilter") || o.isA("sap.m.SegmentedButtonItem");
            });

            if (aTabs.length === 0) return;

            aTabs.forEach(function (oTab) {
                var sKey = "";
                if (typeof oTab.getKey === "function") sKey = oTab.getKey();
                if (typeof oTab.getId === "function" && !sKey) sKey = oTab.getId();

                if (!sKey) return;

                var bShouldBeVisible = true;
                var sTargetKey = sKey.toUpperCase();

                if (sMode === "employeeMode") {
                    if (sTargetKey.indexOf("ADMINTAB") !== -1) {
                        bShouldBeVisible = false;
                    }
                }

                if (typeof oTab.getVisible === "function" && oTab.getVisible() !== bShouldBeVisible) {
                    oTab.setVisible(bShouldBeVisible);
                }
            }.bind(this));
        },

        _checkAndApplyRoleAuth: function (oAppModel) {
            if (window._jhahAuthChecked) return;
            window._jhahAuthChecked = true;
            var oExtension = this;

            this._log("Auth Check: Triggered. Requesting /authInfo from backend...");

            var applyMode = function (sMode) {
                document.body.classList.remove("employeeMode", "adminMode");
                document.body.classList.add(sMode);
                var oView = oExtension.base.getView();
                if (oView) {
                    oView.removeStyleClass("employeeMode");
                    oView.removeStyleClass("adminMode");
                    oView.addStyleClass(sMode);
                }

                window._jhahCurrentMode = sMode;
                oExtension._log("Role Successfully Applied to UI: " + sMode);
                oExtension._applyTabAuthorizations(sMode);
            };

            try {
                var oListBinding = oAppModel.bindList("/authInfo", null, null, null, { $$groupId: "$direct" });
                oListBinding.requestContexts(0, 1).then(function (aContexts) {
                    if (aContexts && aContexts.length > 0) {
                        var oUserData = aContexts[0].getObject();
                        var bIsAdmin = (oUserData.IsAdmin === true || oUserData.IsAdmin === "X" || oUserData.IsAdmin === "true" || oUserData.IsAdmin === "1");

                        // Apply the strict WEBIDE -> Employee fallback you provided
                        var sUserId = "";
                        try { if (sap.ushell && sap.ushell.Container) sUserId = sap.ushell.Container.getService("UserInfo").getId(); } catch (e) { }

                        if (sUserId && sUserId.toUpperCase() === "WEBIDE") {
                            bIsAdmin = true;
                            oExtension._log("Auth Check: WEBIDE user detected. Forcing Employee mode.");
                        } else if ((oUserData.UserId && oUserData.UserId.toUpperCase() === "WEBIDE") ||
                            (oUserData.Uname && oUserData.Uname.toUpperCase() === "WEBIDE")) {
                            bIsAdmin = true;
                            oExtension._log("Auth Check: WEBIDE user detected. Forcing Employee mode.");
                        }

                        if (bIsAdmin) applyMode("adminMode");
                        else applyMode("employeeMode");

                    } else {
                        applyMode("employeeMode");
                    }
                }).catch(function (oError) {
                    oExtension._log("Auth Check: Request failed. Defaulting to Employee.", oError);
                    applyMode("employeeMode");
                });
            } catch (e) {
                oExtension._log("Auth Check: Binding error. Defaulting to Employee.", e);
                applyMode("employeeMode");
            }
        },

        // ========================================================================
        // 2. ISOLATED REQUIREMENT HELPERS
        // ========================================================================

        _isInsideTable: function (oControl) {
            var oNode = oControl;
            while (oNode && typeof oNode.getParent === "function") {
                if (oNode.isA && (oNode.isA("sap.m.Table") || oNode.isA("sap.ui.table.Table"))) return true;
                oNode = oNode.getParent();
            }
            return false;
        },

        _isEvidenceTableAction: function (oControl) {
            var oNode = oControl;
            while (oNode && typeof oNode.getParent === "function") {
                var sId = typeof oNode.getId === "function" ? String(oNode.getId() || "") : "";
                if (sId.indexOf("_Evidence") !== -1) return true;
                if (oNode.isA && oNode.isA("sap.m.Table")) {
                    var oBindingInfo = typeof oNode.getBindingInfo === "function" ? oNode.getBindingInfo("items") : null;
                    var sBindingPath = oBindingInfo && oBindingInfo.path ? String(oBindingInfo.path) : "";
                    return (sId.indexOf("Evidence") !== -1 || sBindingPath.indexOf("Evidence") !== -1);
                }
                oNode = oNode.getParent();
            }
            return false;
        },

        _logEvidenceUploadState: function (oExtension, oView) {
            var aTables = oView.findAggregatedObjects(true, function (oControl) {
                if (!oControl || !oControl.isA || !oControl.isA("sap.m.Table")) return false;
                var sId = String(oControl.getId() || "");
                var oBindingInfo = typeof oControl.getBindingInfo === "function" ? oControl.getBindingInfo("items") : null;
                var sPath = oBindingInfo && oBindingInfo.path ? String(oBindingInfo.path) : "";
                return (sId.indexOf("Evidence") !== -1 || sPath.indexOf("Evidence") !== -1);
            });

            aTables.forEach(function (oTable) {
                var oDomRef = oTable.getDomRef();
                if (!oDomRef) return;
                var $table = $(oDomRef);
                var iRows = $table.find("tbody tr").length;
                var iUploaders = $table.find(".sapUiUfdFileUploader, [id*='uploader']").length;
                var sSignature = oTable.getId() + "|" + iRows + "|" + iUploaders;

                if (oExtension._lastAttachmentDebugSignature !== sSignature) {
                    oExtension._lastAttachmentDebugSignature = sSignature;
                }
            });
        },

        _hideEditingStatusFilter: function () {
            var oExtension = this;
            var oView = this.base.getView();

            if (this._pEditingStatusReset) clearInterval(this._pEditingStatusReset);

            var iAttempts = 0, iMaxAttempts = 50;
            var sHiddenStyle = "display: none !important; width: 0px !important; margin: 0px !important; padding: 0px !important; position: absolute !important; pointer-events: none !important; border: none !important; min-width: 0px !important; max-width: 0px !important; flex: 0 0 0 !important; overflow: hidden !important; visibility: hidden !important;";

            this._pEditingStatusReset = setInterval(function () {
                iAttempts++;
                try {
                    var aBars = oView.findAggregatedObjects(true, function (oControl) {
                        return (oControl && oControl.isA && (oControl.isA("sap.ui.mdc.FilterBar") || oControl.isA("sap.ui.comp.smartfilterbar.SmartFilterBar")));
                    });

                    var oFilterBar = null;
                    for (var i = 0; i < aBars.length; i++) {
                        var sFilterId = aBars[i].getId() || "";
                        if (sFilterId.indexOf("fe::FilterBar::header::FilterBar") !== -1 || sFilterId.indexOf("listReportFilter") !== -1) { oFilterBar = aBars[i]; break; }
                    }
                    if (!oFilterBar && aBars.length > 0) oFilterBar = aBars[0];

                    if (oFilterBar) {
                        if (oFilterBar._oP13nFilter && typeof oFilterBar._oP13nFilter.getP13nData === "function") {
                            var oP13nData = oFilterBar._oP13nFilter.getP13nData();
                            if (oP13nData && Array.isArray(oP13nData.items)) {
                                var oEditState = oP13nData.items.find(function (oItem) { return (oItem.key === "$editState" || oItem.name === "$editState"); });
                                if (oEditState) {
                                    oEditState.visible = false;
                                    try {
                                        if (typeof oFilterBar.setFilterConditions === "function" && typeof oFilterBar.getFilterConditions === "function") {
                                            var mConditions = oFilterBar.getFilterConditions() || {};
                                            if (mConditions["$editState"]) { delete mConditions["$editState"]; oFilterBar.setFilterConditions(mConditions); }
                                        }
                                        oFilterBar._oP13nFilter.setP13nData(oP13nData);
                                    } catch (e) { }
                                }
                            }
                        }

                        if (typeof oFilterBar.getFilterItems === "function") {
                            var aItems = oFilterBar.getFilterItems() || [];
                            aItems.forEach(function (oItem) {
                                var sId = String(oItem.getId() || "");
                                if (sId.indexOf("editState") !== -1 || sId.indexOf("EditingStatus") !== -1 || sId.indexOf("DraftEditingStatus") !== -1) {
                                    try { oItem.setVisible(false); if (typeof oItem.setVisibleInFilterBar === "function") oItem.setVisibleInFilterBar(false); } catch (e) { }
                                }
                            });
                        }
                    }

                    if (oView && oView.$) {
                        var $view = oView.$();
                        $view.find(".sapMText, .sapUiCompFilterBarActiveFiltersText").each(function () {
                            var sTxt = $(this).text() || "";
                            if (sTxt.indexOf("filter active") !== -1 && sTxt.indexOf("Editing Status") !== -1) {
                                if (sTxt === "1 filter active: Editing Status") $(this).hide();
                                else {
                                    var sNewText = sTxt.replace("Editing Status, ", "").replace(", Editing Status", "");
                                    var iCount = parseInt(sNewText.charAt(0), 10);
                                    if (!isNaN(iCount)) {
                                        iCount--;
                                        var sFinalText = iCount + sNewText.substring(1);
                                        if (iCount === 1) sFinalText = sFinalText.replace("filters", "filter");
                                        $(this).text(sFinalText);
                                    }
                                }
                            }
                        });

                        $view.find("label").each(function () {
                            var sLabelText = $(this).text() || "";
                            if (sLabelText.indexOf("Editing Status") !== -1 || sLabelText.indexOf("Editing status") !== -1) {
                                var $wrapper = $(this).closest("[class*='FilterBarItem'], [class*='AFLLayoutItem'], [class*='sapUiLayoutColumn'], [class*='FilterBarBaseItem']");
                                if ($wrapper.length > 0) $wrapper.attr("style", sHiddenStyle); else $(this).parent().attr("style", sHiddenStyle);
                            }
                        });

                        $view.find("[id*='DraftEditingStatus'], [id*='editState'], [id*='EditingStatus']").each(function () {
                            var $wrapper = $(this).closest("[class*='FilterBarItem'], [class*='AFLLayoutItem'], [class*='sapUiLayoutColumn'], [class*='FilterBarBaseItem']");
                            if ($wrapper.length > 0) $wrapper.attr("style", sHiddenStyle); else $(this).attr("style", sHiddenStyle);
                        });
                    }
                } catch (e) { }

                if (iAttempts >= iMaxAttempts) { clearInterval(oExtension._pEditingStatusReset); oExtension._pEditingStatusReset = null; }
            }, 200);
        },
        _applyRequirementUI: function () {
            var oExtension = this;
            var oView = this.base.getView();

            if (this._requirementUIInterval) clearInterval(this._requirementUIInterval);

            this._requirementUIInterval = setInterval(function () {
                try {
                    if (window._jhahCurrentMode) oExtension._applyTabAuthorizations(window._jhahCurrentMode);

                    var $view = oView.$();
                    if (!$view || $view.length === 0) return;

                    // ========================================================================
                    // 2. BULLETPROOF RECORD OWNERSHIP LOGIC
                    // ========================================================================
                    var sViewId = oView.getId() || "";
                    var bIsObjectPageController = sViewId.indexOf("headerObjectPage") !== -1;

                    // We ONLY let the Object Page controller handle this to stop the List Report controller from fighting it!
                    if (bIsObjectPageController) {
                        var bIsObjectPage = window.location.hash.indexOf("header(") !== -1 || window.location.hash.indexOf("Create") !== -1;

                        if (bIsObjectPage) {
                            var bIsCreateMode = window.location.hash.indexOf("Create") !== -1;
                            if (bIsCreateMode) {
                                oExtension._bIsMine = true;
                                oExtension._bOwnershipKnown = true;
                            }

                            if (oExtension._bOwnershipKnown) {
                                var sStateApplied = oExtension._bIsMine ? "myRequestMode" : "otherRequestMode";

                                // Only manipulate the DOM classes if the state has ACTUALLY changed
                                if (oExtension._lastLoggedUIState !== sStateApplied) {
                                    oView.removeStyleClass("loadingOwnershipMode");
                                    document.body.classList.remove("loadingOwnershipMode");

                                    if (oExtension._bIsMine) {
                                        oView.removeStyleClass("otherRequestMode");
                                        document.body.classList.remove("otherRequestMode");
                                        oView.addStyleClass("myRequestMode");
                                        document.body.classList.add("myRequestMode");
                                    } else {
                                        oView.removeStyleClass("myRequestMode");
                                        document.body.classList.remove("myRequestMode");
                                        oView.addStyleClass("otherRequestMode");
                                        document.body.classList.add("otherRequestMode");
                                    }

                                    oExtension._log("UI Rendering State applied: " + sStateApplied);
                                    oExtension._lastLoggedUIState = sStateApplied;
                                }

                            } else {
                                if (oExtension._lastLoggedUIState !== "loadingOwnershipMode") {
                                    oView.addStyleClass("loadingOwnershipMode");
                                    document.body.classList.add("loadingOwnershipMode");
                                    oExtension._log("UI Rendering State applied: loadingOwnershipMode (Waiting for backend)");
                                    oExtension._lastLoggedUIState = "loadingOwnershipMode";
                                }
                            }
                        } else {
                            if (oExtension._lastLoggedUIState !== "listReportMode") {
                                oView.removeStyleClass("myRequestMode", "otherRequestMode", "loadingOwnershipMode");
                                document.body.classList.remove("myRequestMode", "otherRequestMode", "loadingOwnershipMode");
                                oExtension._lastLoggedUIState = "listReportMode";
                            }
                        }
                    }
                    // ========================================================================

                    var bIsDraft = oExtension._bIsDraft === true;
                    var bIsEditMode = $view.find(".sapMInputBaseInner:not([readonly])").length > 0;

                    // 3. EVIDENCE UPLOADERS
                    var aUploaders = oView.findAggregatedObjects(true, function (oControl) {
                        return oControl && typeof oControl.isA === "function" && oControl.isA("sap.ui.unified.FileUploader");
                    });

                    aUploaders.forEach(function (oUploader) {
                        var sUploaderId = typeof oUploader.getId === "function" ? oUploader.getId() : null;
                        if (!sUploaderId) return;
                        var sButtonId = sUploaderId + "-fu_button";
                        var oUploadButton = sap.ui.core.Element.registry.get(sButtonId);

                        // [JHAH FIX LOG: Safe property setting to prevent FileUploader blinking]
                        if (typeof oUploader.getIcon === "function" && oUploader.getIcon() !== "") oUploader.setIcon("");
                        if (typeof oUploader.getIconOnly === "function" && oUploader.getIconOnly() !== false) oUploader.setIconOnly(false);
                        if (typeof oUploader.getButtonText === "function" && oUploader.getButtonText() !== "Upload") oUploader.setButtonText("Upload");

                        if (oUploadButton) {
                            if (typeof oUploadButton.getText === "function" && oUploadButton.getText() !== "Upload") oUploadButton.setText("Upload");
                            if (typeof oUploadButton.getIcon === "function" && oUploadButton.getIcon() !== "") oUploadButton.setIcon("");
                        }
                    });

                    // 4. Action Buttons Iteration
                    $view.find("button.sapMBtn").each(function () {
                        var oCtrl = Element.closestTo(this);
                        if (!oCtrl) return;

                        if (typeof oCtrl.getIcon === "function" && oCtrl.getIcon() === "sap-icon://action-settings" && oExtension._isInsideTable(oCtrl)) {
                            var oSettingsDom = typeof oCtrl.getDomRef === "function" ? oCtrl.getDomRef() : null;
                            if (oSettingsDom && oSettingsDom.style.display !== "none") $(oSettingsDom).hide();
                            return;
                        }

                        var sTextUpper = (typeof oCtrl.getText === "function" ? oCtrl.getText() : "").toUpperCase();
                        var sId = typeof oCtrl.getId === "function" ? oCtrl.getId() : "";
                        var bIsEvidenceTableAction = oExtension._isEvidenceTableAction(oCtrl);

                        if (sTextUpper === "MARK AS CLOSED" || sId.indexOf("MarkAsComplete") !== -1) {
                            if (sId.indexOf("headerObjectPage") === -1) return;

                            // We now calculate what visibility it SHOULD have, check what it currently HAS, 
                            // and ONLY update it if they don't match. This stops the infinite re-rendering loop.
                            var bTargetVisibility = !(bIsDraft || bIsEditMode);
                            if (typeof oCtrl.getVisible === "function" && oCtrl.getVisible() !== bTargetVisibility) {
                                oCtrl.setVisible(bTargetVisibility);
                            }
                            return;
                        }

                        if (sTextUpper === "DELETE" || sId.indexOf("StandardAction::Delete") !== -1) {
                            if (bIsEvidenceTableAction && !oCtrl.data("jhahDeleteHooked")) {
                                oCtrl.data("jhahDeleteHooked", true);
                                if (typeof oCtrl.attachPress === "function") {
                                    oCtrl.attachPress(function () {
                                        window._jhahAttachmentDeleteDialogPending = true;
                                        setTimeout(function () { window._jhahAttachmentDeleteDialogPending = false; }, 5000);
                                    });
                                }
                            }
                            return;
                        }
                    });

                    // 5. Attachment Delete Dialog Text Replacer
                    if (window._jhahAttachmentDeleteDialogPending === true) {
                        var aDialogs = sap.ui.core.Element.registry.filter(function (oControl) {
                            return (oControl && oControl.isA && oControl.isA("sap.m.Dialog") && typeof oControl.isOpen === "function" && oControl.isOpen());
                        });

                        aDialogs.forEach(function (oDialog) {
                            var sTitle = typeof oDialog.getTitle === "function" ? String(oDialog.getTitle() || "").toLowerCase().trim() : "";
                            if (sTitle !== "delete" || oDialog.data("jhahDeleteDialogHandled")) return;

                            oDialog.data("jhahDeleteDialogHandled", true);
                            if (typeof oDialog.setTitle === "function") oDialog.setTitle("Delete Attachment");

                            var aTexts = oDialog.findAggregatedObjects(true, function (oControl) {
                                return (oControl && oControl.isA && (oControl.isA("sap.m.Text") || oControl.isA("sap.m.FormattedText")));
                            });

                            aTexts.forEach(function (oText) {
                                var sTextContent = typeof oText.getText === "function" ? String(oText.getText() || "") : "";
                                var sLower = sTextContent.toLowerCase();

                                if (sLower.indexOf("delete this object") !== -1 || sLower.indexOf("delete object") !== -1) {
                                    oText.setText(sTextContent.replace(/delete this object/ig, "delete this attachment").replace(/delete object/ig, "delete attachment"));
                                } else if (sLower.indexOf("selected objects") !== -1 || sLower.indexOf("remaining objects") !== -1) {
                                    oText.setText(sTextContent.replace(/selected objects/ig, "selected attachments").replace(/remaining objects/ig, "remaining attachments"));
                                }
                            });

                            var aButtons = typeof oDialog.getButtons === "function" ? oDialog.getButtons() : [];
                            aButtons.forEach(function (oBtn) {
                                var sBtnTxt = oBtn.getText() ? String(oBtn.getText()).trim().toLowerCase() : "";
                                if (sBtnTxt === "delete") {
                                    if (!oBtn.data("jhahAttachmentConfirmHooked")) {
                                        oBtn.data("jhahAttachmentConfirmHooked", true);
                                        oBtn.attachPress(function () {
                                            window._jhahAttachmentDeleteToastPending = true;
                                            setTimeout(function () { window._jhahAttachmentDeleteToastPending = false; }, 15000);
                                        });
                                    }
                                }
                            });
                            window._jhahAttachmentDeleteDialogPending = false;
                        });
                    }

                } catch (e) { }
            }, 500);
        },

        // ========================================================================
        // 3. BASELINE METHODS
        // ========================================================================

        _fetchViolatorDetails: function (sJhahId) {
            var oView = this.base.getView();
            var oAppModel = oView.getModel();
            var oViolatorModel = oView.getModel("violator");

            if (!oAppModel || !oViolatorModel) return;

            var sCleanId = (sJhahId || "").trim();
            if (this._sLatestRequestedId === sCleanId) return;

            this._sLatestRequestedId = sCleanId;

            if (sCleanId !== "") {
                var sPath = "/employee('" + sCleanId + "')";
                var oContext = oAppModel.bindContext(sPath, null, { "$$groupId": "$direct" });

                oContext.requestObject().then(function (oData) {
                    if (this._sLatestRequestedId !== sCleanId) return;
                    if (oData) oViolatorModel.setData(Object.assign({}, oData, { isVisible: true }));
                    else oViolatorModel.setData({ isVisible: false });
                    oViolatorModel.refresh(true);
                }.bind(this)).catch(function (err) {
                    if (this._sLatestRequestedId !== sCleanId) return;
                    oViolatorModel.setData({ isVisible: false });
                    oViolatorModel.refresh(true);
                }.bind(this));
            } else {
                oViolatorModel.setData({ isVisible: false });
                oViolatorModel.refresh(true);
            }
        },

        _onJhahIdModelChanged: function (oEvent) {
            var sNewVal = oEvent.getSource().getValue();
            this._fetchViolatorDetails(sNewVal);
        },

        _startCountdown: function (sStartDate, sStartTime) {
            var oView = this.base.getView();
            var oCountdownModel = oView.getModel("countdown");

            if (this._countdownInterval) clearInterval(this._countdownInterval);

            if (!sStartDate || !sStartTime) {
                oCountdownModel.setProperty("/isVisible", false);
                return;
            }

            var sCleanDate = typeof sStartDate === "string" ? sStartDate.split("T")[0] : (sStartDate instanceof Date ? sStartDate.toISOString().split("T")[0] : null);
            var sCleanTime = typeof sStartTime === "string" ? sStartTime : null;

            if (!sCleanDate || !sCleanTime) {
                oCountdownModel.setProperty("/isVisible", false);
                return;
            }

            var dTargetDate = new Date(sCleanDate + "T" + sCleanTime);
            if (isNaN(dTargetDate.getTime())) {
                oCountdownModel.setProperty("/isVisible", false);
                return;
            }

            var updateTimer = function () {
                var dNow = new Date();
                var iDistance = dTargetDate.getTime() - dNow.getTime();

                if (iDistance <= 0) {
                    clearInterval(this._countdownInterval);
                    oCountdownModel.setProperty("/isVisible", false);
                    return;
                }

                var iDays = Math.floor(iDistance / (1000 * 60 * 60 * 24));
                var iHours = Math.floor((iDistance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                var iMinutes = Math.floor((iDistance % (1000 * 60 * 60)) / (1000 * 60));
                var iSeconds = Math.floor((iDistance % (1000 * 60)) / 1000);

                var sTimerText = "";
                if (iDays > 0) sTimerText += iDays + "d ";
                sTimerText += iHours.toString().padStart(2, '0') + "h " + iMinutes.toString().padStart(2, '0') + "m " + iSeconds.toString().padStart(2, '0') + "s";

                oCountdownModel.setProperty("/isVisible", true);
                oCountdownModel.setProperty("/timeRemaining", sTimerText);
            }.bind(this);

            updateTimer();
            this._countdownInterval = setInterval(updateTimer, 1000);
        },


        // ========================================================================
        // OVERRIDES & LIFECYCLE HOOKS
        // ========================================================================

        override: {
            onInit: function () {
                var oExtension = this;
                var oView = oExtension.base.getView();

                this._log("App Initializing...");

                var oFioriI18nModel = oView && oView.getModel("sap.fe.i18n");

                if (oFioriI18nModel && !oFioriI18nModel.__jhahCustomTextsApplied) {
                    oFioriI18nModel.enhance({ bundleName: "com.jhah.zhrjhahsectvs.i18n.i18n" });

                    oFioriI18nModel.__jhahCustomTextsApplied = true;

                    this._log(
                        "Fiori Elements texts enhanced.",
                        {
                            bundleName:
                                "com.jhah.zhrjhahsecid.i18n.i18n"
                        }
                    );
                }

                sap.ui.require(["sap/m/MessageToast"], function (MessageToast) {
                    if (!window._jhahMessageToastHooked) {
                        window._jhahOriginalMessageToastShow = MessageToast.show;
                        window._jhahMessageToastHookUsers = 0;

                        MessageToast.show = function () {
                            var sMessage = arguments[0];
                            var sStrMessage = String(sMessage || "").trim().toLowerCase().replace(/[.!?]+$/, "");

                            if (window._jhahAttachmentDeleteToastPending === true && sStrMessage === "object deleted") {
                                window._jhahAttachmentDeleteToastPending = false;
                                arguments[0] = "Attachment deleted successfully.";
                            } else if (window._jhahSubmitPending === true && sStrMessage === "object created") {
                                window._jhahSubmitPending = false;
                                arguments[0] = "Violation submitted successfully.";
                            }
                            return window._jhahOriginalMessageToastShow.apply(MessageToast, arguments);
                        };
                        window._jhahMessageToastHooked = true;
                    }
                    window._jhahMessageToastHookUsers++;
                });

                try {
                    var oCountdownModel = new JSONModel({ isVisible: false, timeRemaining: "", isEditMode: false });
                    oView.setModel(oCountdownModel, "countdown");

                    var oViolatorModel = new JSONModel({ isVisible: false });
                    oView.setModel(oViolatorModel, "violator");

                    oView.addStyleClass("zhrjhahsectvs-app");
                    document.body.classList.add("zhrjhahsectvs-app");

                    oView.addEventDelegate({
                        onAfterRendering: function () {
                            // 1. Instantly Check Auth on Load (Moved here to guarantee Model exists)
                            var oAppModel = oView.getModel();
                            if (oAppModel && !window._jhahAuthChecked) {
                                oExtension._checkAndApplyRoleAuth(oAppModel);
                            }

                            oExtension._hideEditingStatusFilter();
                            oExtension._applyRequirementUI();

                            try {
                                var $view = oView.$();

                                // Plate & Sticker Restriction Logic
                                if (!$view.data("customRestrictionsAttached")) {
                                    $view.on("input.customRestrictions", "input", function (oEvent) {
                                        var oInputControl = Element.closestTo(oEvent.target);
                                        if (!oInputControl) return;

                                        var sBindingPath = null;
                                        var oCurrentNode = oInputControl;
                                        while (oCurrentNode && typeof oCurrentNode.getParent === "function") {
                                            if (typeof oCurrentNode.getBindingPath === "function") {
                                                sBindingPath = oCurrentNode.getBindingPath("value");
                                                if (sBindingPath) break;
                                            }
                                            oCurrentNode = oCurrentNode.getParent();
                                        }

                                        if (!sBindingPath) return;
                                        var oContext = oInputControl.getBindingContext();
                                        if (!oContext) return;
                                        var oData = oContext.getObject();

                                        var bIsAnyPlateField = (sBindingPath.indexOf("PlateDigits") !== -1 || sBindingPath.indexOf("PlateNum1") !== -1 || sBindingPath.indexOf("PlateNum2") !== -1 || sBindingPath.indexOf("PlateNum3") !== -1);
                                        if (bIsAnyPlateField) {
                                            if (!oData.PlateTyp || oData.PlateTyp.trim() === "") {
                                                oEvent.target.value = "";
                                                oInputControl.setValue("");
                                                if (oInputControl.setValueState) {
                                                    oInputControl.setValueState("Error");
                                                    oInputControl.setValueStateText("Please select Plate Type first.");
                                                    setTimeout(function () { if (oInputControl && !oInputControl.bIsDestroyed) { oInputControl.setValueState("None"); oInputControl.setValueStateText(""); } }, 3000);
                                                }
                                                return;
                                            }
                                        }

                                        var bIsStickerField = (sBindingPath.toUpperCase().indexOf("STICKERNUMBER") !== -1);
                                        if (bIsStickerField) {
                                            var bIsPrivate = false;
                                            for (var key in oData) {
                                                if (key.toUpperCase().indexOf("VEHICLETYPE") !== -1 && typeof oData[key] === "string" && key.indexOf("Desc") === -1) {
                                                    if (oData[key].toUpperCase().indexOf("PRIVATE") !== -1 || oData[key].toUpperCase().indexOf("PVT") !== -1) { bIsPrivate = true; break; }
                                                }
                                            }
                                            if (!bIsPrivate) {
                                                $view.find("input").each(function () {
                                                    var sId = ($(this).attr("id") || "").toUpperCase();
                                                    if (sId.indexOf("VEHICLETYPE") !== -1) {
                                                        var v = $(this).val().toUpperCase();
                                                        if (v.indexOf("PRIVATE") !== -1 || v.indexOf("PVT") !== -1) bIsPrivate = true;
                                                    }
                                                });
                                            }
                                            var sVehicleType = String(oData.VehicleType || "").trim();

                                            if (bIsPrivate || sVehicleType === "") {
                                                var sVal = oInputControl.getValue() || "";
                                                var sNewVal = sVal;
                                                var bHadInvalidPrefix = false;
                                                var bHadLetters = false;

                                                if (sVal !== "") {
                                                    if (sVal.indexOf("JHS-") !== 0) bHadInvalidPrefix = true;
                                                    var afterPrefix = sVal.replace("JHS-", "");
                                                    var sDigits = afterPrefix.replace(/\D/g, '');
                                                    if (afterPrefix !== sDigits) bHadLetters = true;
                                                    sDigits = sDigits.substring(0, 8);
                                                    sNewVal = "JHS-" + sDigits;
                                                    if (sDigits === "" && sVal.length <= 4 && sVal !== "JHS-") {
                                                        if (!sVal.startsWith("JHS-")) sNewVal = "JHS-";
                                                    }
                                                }

                                                if (oInputControl.getValue() !== sNewVal) {
                                                    oEvent.target.value = sNewVal; oInputControl.setValue(sNewVal);
                                                }

                                                if (oInputControl.setValueState) {
                                                    if (sNewVal !== "") {
                                                        if (bHadInvalidPrefix) {
                                                            oInputControl.setValueState("Error");
                                                            oInputControl.setValueStateText("Sticker numbers must begin with the 'JHS-' prefix.");
                                                        } else if (bHadLetters) {
                                                            oInputControl.setValueState("Error");
                                                            oInputControl.setValueStateText("Only numeric digits are permitted after the prefix.");
                                                        } else {
                                                            oInputControl.setValueState("None"); oInputControl.setValueStateText("");
                                                        }
                                                    } else { oInputControl.setValueState("None"); }
                                                }
                                            }
                                        }
                                    });
                                    $view.data("customRestrictionsAttached", true);
                                }

                                // Instant Typing Listener for JHAH ID
                                if (!$view.data("jhahIdEventAttached")) {
                                    var timeoutId = null;
                                    $view.on("input.jhahIdListener", "input", function (oEvent) {
                                        var oInputControl = Element.closestTo(oEvent.target);
                                        if (!oInputControl) return;

                                        var bIsTargetField = false;
                                        var oCurrentNode = oInputControl;
                                        while (oCurrentNode && typeof oCurrentNode.getParent === "function") {
                                            var sId = (oCurrentNode.getId() || "").toUpperCase();
                                            var sBindingPath = "";
                                            if (typeof oCurrentNode.getBindingPath === "function") sBindingPath = (oCurrentNode.getBindingPath("value") || "").toUpperCase();
                                            if (sId.indexOf("JHAHID") !== -1 || sId.indexOf("PERNR") !== -1 || sId.indexOf("PAYROLL") !== -1 ||
                                                sBindingPath.indexOf("JHAHID") !== -1 || sBindingPath.indexOf("PERNR") !== -1 || sBindingPath.indexOf("PAYROLL") !== -1) {
                                                bIsTargetField = true; break;
                                            }
                                            oCurrentNode = oCurrentNode.getParent();
                                        }

                                        if (bIsTargetField) {
                                            var sVal = oEvent.target.value;
                                            if (timeoutId) clearTimeout(timeoutId);
                                            if (!sVal || sVal.trim() === "") oExtension._fetchViolatorDetails("");
                                            else {
                                                if (sVal !== oExtension._sLatestRequestedId) {
                                                    var oViolatorModel = oView.getModel("violator");
                                                    if (oViolatorModel) { oViolatorModel.setData({ isVisible: false }); oViolatorModel.refresh(true); }
                                                }
                                                timeoutId = setTimeout(function () { oExtension._fetchViolatorDetails(sVal); }, 500);
                                            }
                                        }
                                    });
                                    $view.data("jhahIdEventAttached", true);
                                }

                                // Future Date & Time Validator
                                if (!$view.data("dateTimeValidatorAttached")) {
                                    $view.on("change focusout", "input", function (oEvent) {
                                        var oInputControl = Element.closestTo(oEvent.target);
                                        if (!oInputControl || typeof oInputControl.getBindingPath !== "function") return;

                                        var sBindingPath = oInputControl.getBindingPath("value");
                                        if (!sBindingPath) return;

                                        var sPathUpper = sBindingPath.toUpperCase();
                                        if (sPathUpper.indexOf("VIOLATIONTIME") !== -1 || sPathUpper.indexOf("VIOLATIONDATE") !== -1) {
                                            var oContext = oInputControl.getBindingContext();
                                            if (oContext) {
                                                var oData = oContext.getObject();
                                                var currentDate = new Date();
                                                var selDate = oData.ViolationDate || oData.violationdate ? new Date(oData.ViolationDate || oData.violationdate) : null;

                                                if (selDate && selDate.toDateString() === currentDate.toDateString()) {
                                                    var sTimeVal = "";
                                                    var oTimePicker = null;

                                                    if (sPathUpper.indexOf("VIOLATIONTIME") !== -1) {
                                                        sTimeVal = oInputControl.getValue();
                                                        oTimePicker = oInputControl;
                                                    } else {
                                                        $view.find("input").each(function () {
                                                            var ctrl = Element.closestTo(this);
                                                            if (ctrl && ctrl.getBindingPath && (ctrl.getBindingPath("value") || "").toUpperCase().indexOf("VIOLATIONTIME") !== -1) {
                                                                sTimeVal = ctrl.getValue(); oTimePicker = ctrl;
                                                            }
                                                        });
                                                    }

                                                    if (sTimeVal && oTimePicker) {
                                                        var timeParts = sTimeVal.split(":");
                                                        if (timeParts.length >= 2) {
                                                            var selHours = parseInt(timeParts[0], 10);
                                                            var selMins = parseInt(timeParts[1], 10);
                                                            if (sTimeVal.toUpperCase().indexOf("PM") !== -1 && selHours < 12) selHours += 12;
                                                            if (sTimeVal.toUpperCase().indexOf("AM") !== -1 && selHours === 12) selHours = 0;

                                                            var currHours = currentDate.getHours();
                                                            var currMins = currentDate.getMinutes();

                                                            if (selHours > currHours || (selHours === currHours && selMins > currMins)) {
                                                                if (oTimePicker.setValueState) {
                                                                    oTimePicker.setValueState("Error");
                                                                    oTimePicker.setValueStateText("Cannot select a future time for today's date.");
                                                                }
                                                                oTimePicker.setValue(currHours.toString().padStart(2, '0') + ":" + currMins.toString().padStart(2, '0') + ":00");
                                                                setTimeout(function () {
                                                                    if (oTimePicker && oTimePicker.setValueState) { oTimePicker.setValueState("None"); oTimePicker.setValueStateText(""); }
                                                                }, 4000);
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    });
                                    $view.data("dateTimeValidatorAttached", true);
                                }

                                // DYNAMIC ASTERISK & PLACEHOLDER UI INTERVAL
                                if (!$view.data("dynamicUIFeaturesAttached")) {
                                    setInterval(function () {
                                        try {
                                            var $editableInputs = $view.find(".sapMInputBaseInner:not([readonly])");
                                            var bIsEditMode = $editableInputs.length > 0;

                                            var $kpiContainer = $view.find('.sapUxAPObjectPageHeaderContentFlexBox, [id*="::HeaderFacet::"]').first().parent();
                                            var $countdownBox = $view.find(".customKpiBox");
                                            if ($kpiContainer.length > 0 && $countdownBox.length > 0) {
                                                if ($kpiContainer.children().first()[0] !== $countdownBox[0]) $kpiContainer.prepend($countdownBox);
                                            }

                                            var oCurrentCountdownModel = oView.getModel("countdown");
                                            if (oCurrentCountdownModel && oCurrentCountdownModel.getProperty("/isEditMode") !== bIsEditMode) {
                                                oCurrentCountdownModel.setProperty("/isEditMode", bIsEditMode);
                                            }

                                            var sPlateType = "", sVehicleType = "";
                                            $view.find("input").each(function () {
                                                var $input = $(this);
                                                var sId = ($input.attr("id") || "").toUpperCase();
                                                var oCtrl = Element.closestTo(this);

                                                if (sId.indexOf("PLATETYP") !== -1) sPlateType = $input.val() || sPlateType;
                                                if (sId.indexOf("VEHICLETYPE") !== -1) sVehicleType = $input.val() || sVehicleType;

                                                var bIsStickerInput = sId.indexOf("STICKERNUMBER") !== -1 || (oCtrl && typeof oCtrl.getBindingPath === "function" && String(oCtrl.getBindingPath("value") || "").toUpperCase().indexOf("STICKERNUMBER") !== -1);
                                                if (bIsStickerInput && oCtrl && typeof oCtrl.getValue === "function") {
                                                    var sCurrentVal = String(oCtrl.getValue() || "");
                                                    var bPrivateVehicle = sVehicleType.toUpperCase().indexOf("PRIVATE") !== -1 || sVehicleType.toUpperCase().indexOf("PVT") !== -1;

                                                    if (bPrivateVehicle) {
                                                        // Commented out the placeholder for Private vehicles
                                                        // if (typeof oCtrl.setPlaceholder === "function") oCtrl.setPlaceholder("JHS-XXXXXXXX");
                                                        // else $input.attr("placeholder", "JHS-XXXXXXXX");
                                                    } else {
                                                        // Commented out clearing the placeholder for non-Private vehicles
                                                        // if (typeof oCtrl.setPlaceholder === "function") oCtrl.setPlaceholder("");
                                                        // else $input.attr("placeholder", "");

                                                        // Keep this line intact: It clears out the "JHS-" prefix if the vehicle isn't private
                                                        if (sCurrentVal === "JHS-" && typeof oCtrl.setValue === "function") oCtrl.setValue("");
                                                    }
                                                }

                                                if (oCtrl && typeof oCtrl.setMaxDate === "function") {
                                                    if (!oCtrl.getMaxDate() || oCtrl.getMaxDate().toDateString() !== new Date().toDateString()) {
                                                        oCtrl.setMaxDate(new Date());
                                                    }
                                                }
                                            });

                                            var bIsKSA = (sPlateType.toUpperCase().indexOf("KSA") !== -1);
                                            var bIsCompany = (sVehicleType.toUpperCase().indexOf("CMP") !== -1 || sVehicleType.toUpperCase().indexOf("COMPANY") !== -1);
                                            var bIsPrivate = (sVehicleType.toUpperCase().indexOf("PRIVATE") !== -1 || sVehicleType.toUpperCase().indexOf("PVT") !== -1);
                                            var bIsOthers = (sVehicleType.toUpperCase().indexOf("OTH") !== -1 || sVehicleType.toUpperCase().indexOf("OTHER") !== -1);

                                            var toggleAsterisk = function (sLabelText, bMandatory) {
                                                if (!bIsEditMode) bMandatory = false;
                                                $view.find("label, .sapMLabel").each(function () {
                                                    var $label = $(this);
                                                    var rawText = $label.text().replace(/\*/g, '').trim();
                                                    if (rawText === sLabelText || rawText === sLabelText + ":") {
                                                        var $ast = $label.find(".customRedAsterisk");
                                                        if (bMandatory) {
                                                            if ($ast.length === 0) $label.append("<span class='customRedAsterisk' style='color:#b02323; font-weight:bold; margin-left:3px;'>*</span>");
                                                        } else {
                                                            $ast.remove();
                                                        }
                                                    }
                                                });
                                            };

                                            toggleAsterisk("Vehicle Type", true);
                                            toggleAsterisk("Plate Type", true);
                                            toggleAsterisk("Plate Number", true);
                                            toggleAsterisk("Door Number", bIsCompany);
                                            toggleAsterisk("Other Vehicle Type", bIsOthers);
                                            toggleAsterisk("Plate Letter 1", bIsKSA);
                                            toggleAsterisk("Plate Letter 2", bIsKSA);
                                            toggleAsterisk("Plate Letter 3", bIsKSA);
                                            toggleAsterisk("Sticker Number", bIsPrivate);
                                            toggleAsterisk("Payroll Number", true);

                                            // Mark As Closed Custom FileUploader Dialog Injection
                                            var $dialogs = $(".sapMDialog");
                                            $dialogs.each(function () {
                                                var $dialog = $(this);
                                                var sTitle = $dialog.find(".sapMDialogTitle").text().trim();

                                                if (sTitle === "Mark as Closed" && !$dialog.data("customFileUploaderInjected")) {
                                                    $dialog.data("customFileUploaderInjected", true);
                                                    var oActionDialog = Element.closestTo(this);
                                                    if (!oActionDialog) return;

                                                    sap.ui.require(["sap/ui/unified/FileUploader", "sap/m/Label", "sap/m/Button", "sap/m/MessageToast", "sap/m/MessageBox"],
                                                        function (FileUploader, Label, Button, MessageToast, MessageBox) {
                                                            var oFileUploader = new FileUploader({
                                                                width: "100%", placeholder: "Upload closure evidence (Optional)",
                                                                style: "Emphasized", sameFilenameAllowed: true
                                                            });
                                                            var oLabel = new Label({ text: "Attachment", design: "Standard" });

                                                            var aDialogContent = oActionDialog.getContent();
                                                            if (aDialogContent && aDialogContent.length > 0) {
                                                                var oMainContent = aDialogContent[0];
                                                                if (oMainContent.isA && oMainContent.isA("sap.ui.layout.form.SimpleForm")) {
                                                                    var aFormContent = oMainContent.getContent();
                                                                    for (var j = 0; j < aFormContent.length; j++) {
                                                                        if (aFormContent[j].isA("sap.m.Label") && (aFormContent[j].getText() || "").toLowerCase().indexOf("justification") !== -1) {
                                                                            aFormContent[j].setRequired(true);
                                                                        }
                                                                    }
                                                                    oMainContent.addContent(oLabel);
                                                                    oMainContent.addContent(oFileUploader);
                                                                }
                                                            }

                                                            if (oActionDialog.getBeginButton && oActionDialog.getBeginButton()) oActionDialog.getBeginButton().setVisible(false);
                                                            if (oActionDialog.getEndButton && oActionDialog.getEndButton()) oActionDialog.getEndButton().setVisible(false);
                                                            if (oActionDialog.getButtons && oActionDialog.getButtons().length > 0) oActionDialog.getButtons().forEach(function (b) { b.setVisible(false); });

                                                            var oCustomExecuteBtn = new Button({
                                                                text: "Mark as Closed",
                                                                type: "Emphasized",
                                                                press: function () {
                                                                    var sJustification = "";
                                                                    var oJustificationField = null;
                                                                    var aInputs = oActionDialog.findAggregatedObjects(true, function (oControl) { return oControl.isA("sap.m.TextArea") || oControl.isA("sap.m.Input"); });

                                                                    for (var i = 0; i < aInputs.length; i++) {
                                                                        var sPath = "";
                                                                        if (aInputs[i].getBindingPath) sPath = (aInputs[i].getBindingPath("value") || "").toLowerCase();
                                                                        if (sPath.indexOf("closedjustification") !== -1) { sJustification = aInputs[i].getValue(); oJustificationField = aInputs[i]; break; }
                                                                        else if (i === 0) { sJustification = aInputs[i].getValue(); oJustificationField = aInputs[i]; }
                                                                    }

                                                                    if (!sJustification || sJustification.trim() === "") {
                                                                        if (oJustificationField && oJustificationField.setValueState) {
                                                                            oJustificationField.setValueState("Error"); oJustificationField.setValueStateText("Justification for closure is required.");
                                                                        }
                                                                        MessageBox.error("Please provide a justification for closure.");
                                                                        return;
                                                                    }

                                                                    if (oJustificationField && oJustificationField.setValueState) oJustificationField.setValueState("None");
                                                                    oActionDialog.setBusy(true);

                                                                    var oContext = oActionDialog.getBindingContext();
                                                                    var oFileDom = document.getElementById(oFileUploader.getId() + "-fu");
                                                                    var oFile = oFileDom ? oFileDom.files[0] : null;

                                                                    var executeAction = function (sBase64, sFilename, sMime) {
                                                                        var oAppModel = oView.getModel();
                                                                        var sActionPath = oContext.getPath();
                                                                        var sParentPath = sActionPath.indexOf("/com.sap.gateway") !== -1 ? sActionPath.substring(0, sActionPath.indexOf("/com.sap.gateway")) : sActionPath.split("/").slice(0, -1).join("/");

                                                                        var sFqnAction = "com.sap.gateway.srvd.zsrv_hr_tvs.v0001.MarkAsComplete";
                                                                        var oCustomActionBinding = oAppModel.bindContext(sParentPath + "/" + sFqnAction + "(...)");

                                                                        oCustomActionBinding.setParameter("closedjustification", sJustification);
                                                                        oCustomActionBinding.setParameter("Filename", sFilename || "");
                                                                        oCustomActionBinding.setParameter("Mimetype", sMime || "");
                                                                        oCustomActionBinding.setParameter("AttachmentContent", sBase64 || "");

                                                                        oCustomActionBinding.execute().then(function () {
                                                                            oActionDialog.setBusy(false); oActionDialog.close();
                                                                            MessageToast.show("Successfully Marked as Closed");
                                                                            if (oExtension.base.getExtensionAPI && oExtension.base.getExtensionAPI().refresh) oExtension.base.getExtensionAPI().refresh();
                                                                            oAppModel.refresh();
                                                                        }).catch(function (err) {
                                                                            oActionDialog.setBusy(false);
                                                                            MessageBox.error(err.message || "Failed to process the request.");
                                                                        });
                                                                    };

                                                                    if (oFile) {
                                                                        var reader = new FileReader();
                                                                        reader.onload = function (e) { executeAction(e.target.result.split(",")[1], oFile.name, oFile.type || "application/octet-stream"); };
                                                                        reader.onerror = function () { oActionDialog.setBusy(false); };
                                                                        reader.readAsDataURL(oFile);
                                                                    } else { executeAction("", "", ""); }
                                                                }
                                                            });
                                                            var oCustomCancelBtn = new Button({ text: "Cancel", press: function () { oActionDialog.close(); } });
                                                            oActionDialog.addButton(oCustomExecuteBtn); oActionDialog.addButton(oCustomCancelBtn);
                                                        });
                                                }
                                            });
                                        } catch (err) { }
                                    }, 500);
                                    $view.data("dynamicUIFeaturesAttached", true);
                                }
                            } catch (err) { }
                        }
                    });
                } catch (err) { }
            },

            routing: {
                onAfterBinding: function (oBindingContext) {
                    var oExtension = this;
                    var oView = this.base.getView();
                    var oAppModel = oView.getModel();
                    if (!oAppModel) return;

                    var oViolatorModel = oView.getModel("violator");
                    if (!oViolatorModel) {
                        oViolatorModel = new JSONModel({ isVisible: false });
                        oView.setModel(oViolatorModel, "violator");
                    }

                    if (oBindingContext && oBindingContext.getPath().indexOf("/header") !== -1) {
                        oExtension._log("Routing: Navigated to Object Page...");

                        this._bDraftStateKnown = false;
                        this._bOwnershipKnown = false;

                        var oObject = oBindingContext.getObject();
                        if (oObject && typeof oObject.IsActiveEntity === "boolean") {
                            this._bIsDraft = (oObject.IsActiveEntity === false);
                            this._bDraftStateKnown = true;
                        }

                        oBindingContext.requestProperty("IsActiveEntity").then(function (bIsActiveEntity) {
                            this._bIsDraft = (bIsActiveEntity === false);
                            this._bDraftStateKnown = true;
                        }.bind(this)).catch(function () { });

                        oBindingContext.requestProperty("isMyRequest").then(function (vIsMyReq) {
                            oExtension._log("Ownership Check: Backend returned isMyRequest = " + vIsMyReq);
                            this._bIsMine = (vIsMyReq === true || vIsMyReq === "X" || vIsMyReq === "true");
                            this._bOwnershipKnown = true;
                        }.bind(this)).catch(function () {
                            oBindingContext.requestProperty("IsMyRequest").then(function (vIsMyReq2) {
                                oExtension._log("Ownership Check: Backend returned IsMyRequest = " + vIsMyReq2);
                                this._bIsMine = (vIsMyReq2 === true || vIsMyReq2 === "X" || vIsMyReq2 === "true");
                                this._bOwnershipKnown = true;
                            }.bind(this)).catch(function () {
                                oExtension._log("Ownership Check: Failed to retrieve ownership field.");
                                this._bOwnershipKnown = true;
                            }.bind(this));
                        }.bind(this));

                        oBindingContext.requestProperty("JhahId").then(function (sJhahId) {
                            this._fetchViolatorDetails(sJhahId);
                        }.bind(this)).catch(function (err) { });
                        Promise.all([
                            oBindingContext.requestProperty("wfstartdate").catch(function () { return null; }),
                            oBindingContext.requestProperty("wfstarttime").catch(function () { return null; }),
                            oBindingContext.requestProperty("Status").catch(function () { return null; })
                        ]).then(function (aValues) {
                            var sStartDate = aValues[0];
                            var sStartTime = aValues[1];

                            // .trim() removes any sneaky spaces (e.g. "SUB " becomes "SUB")
                            var sStatusRaw = aValues[2];
                            var sStatus = sStatusRaw ? String(sStatusRaw).trim().toUpperCase() : "";


                            console.log("[JHAH-TVS DEBUG] Cooling Off Check -> Raw Status:", sStatusRaw, "| Clean Status:", sStatus, "| Date:", sStartDate, "| Time:", sStartTime);

                            // ONLY show the Cooling Off box if the status is strictly "SUB" (Submitted)
                            if (sStatus === "NEW") {
                                this._startCountdown(sStartDate, sStartTime);
                            } else {
                                // If it's INP (In Progress), CLD (Closed), or anything else, completely hide it
                                var oCountdownModel = this.base.getView().getModel("countdown");
                                if (oCountdownModel) oCountdownModel.setProperty("/isVisible", false);
                                if (this._countdownInterval) clearInterval(this._countdownInterval);
                            }
                        }.bind(this));
                        // Promise.all([
                        //     oBindingContext.requestProperty("wfstartdate").catch(function () { return null; }),
                        //     oBindingContext.requestProperty("wfstarttime").catch(function () { return null; }),
                        //     oBindingContext.requestProperty("Status").catch(function () { return null; })
                        // ]).then(function (aValues) {
                        //     if (aValues[2] && aValues[2].toUpperCase() === "CLD") {
                        //         var oCountdownModel = this.base.getView().getModel("countdown");
                        //         if (oCountdownModel) oCountdownModel.setProperty("/isVisible", false);
                        //         if (this._countdownInterval) clearInterval(this._countdownInterval);
                        //     } else {
                        //         this._startCountdown(aValues[0], aValues[1]);
                        //     }
                        // }.bind(this));

                        if (this._oJhahIdBinding) {
                            this._oJhahIdBinding.detachChange(this._onJhahIdModelChanged, this);
                            this._oJhahIdBinding.destroy();
                        }
                        this._oJhahIdBinding = oAppModel.bindProperty("JhahId", oBindingContext);
                        this._oJhahIdBinding.attachChange(this._onJhahIdModelChanged, this);
                    }
                }
            },

            onExit: function () {
                if (this._countdownInterval) clearInterval(this._countdownInterval);
                if (this._pEditingStatusReset) clearInterval(this._pEditingStatusReset);
                if (this._requirementUIInterval) { clearInterval(this._requirementUIInterval); this._requirementUIInterval = null; }

                if (window._jhahMessageToastHookUsers !== undefined) {
                    window._jhahMessageToastHookUsers--;
                    if (window._jhahMessageToastHookUsers <= 0 && window._jhahMessageToastHooked) {
                        sap.ui.require(["sap/m/MessageToast"], function (MessageToast) {
                            MessageToast.show = window._jhahOriginalMessageToastShow;
                            window._jhahMessageToastHooked = false;
                            window._jhahOriginalMessageToastShow = null;
                            window._jhahMessageToastHookUsers = 0;
                        });
                    }
                }
            }
        }
    });
});