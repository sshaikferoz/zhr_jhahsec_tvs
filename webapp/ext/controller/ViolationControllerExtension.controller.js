sap.ui.define([
    "sap/ui/core/mvc/ControllerExtension",
    "sap/ui/core/Element",
    "sap/ui/model/json/JSONModel"
], function (ControllerExtension, Element, JSONModel) {
    "use strict";

    return ControllerExtension.extend("com.jhah.zhrjhahsectvs.ext.controller.ViolationControllerExtension", {
        
        override: {
            onInit: function () {
                var oExtension = this;
                var oView = oExtension.base.getView();

                console.log("EXTENSION LOADED SUCCESSFULLY");

                try {
                    // Safe model initialization
                    var oViolatorModel = new JSONModel({ isVisible: false });
                    oView.setModel(oViolatorModel, "violator");

                    oView.addStyleClass("zhrjhahsectvs-app");
                    document.body.classList.add("zhrjhahsectvs-app");

                    oView.addEventDelegate({
                        onAfterRendering: function () {
                            try {
                                var $view = oView.$();
                                
                                if (!$view.data("plateEventAttached")) {
                                    $view.on("input.plateRestriction", "input", function(oEvent) {
                                        var oInputControl = Element.closestTo(oEvent.target);
                                        if (!oInputControl) return;

                                        // --- NEW: CLIMB THE UI TREE TO FIND THE BINDING PATH ---
                                        var sBindingPath = null;
                                        var oCurrentNode = oInputControl;
                                        
                                        while (oCurrentNode && typeof oCurrentNode.getParent === "function") {
                                            if (typeof oCurrentNode.getBindingPath === "function") {
                                                sBindingPath = oCurrentNode.getBindingPath("value");
                                                if (sBindingPath) {
                                                    break; // Found the binding path!
                                                }
                                            }
                                            oCurrentNode = oCurrentNode.getParent();
                                        }

                                        // Ensure we found a path and check if it's one of our target fields
                                        if (sBindingPath && (
                                            sBindingPath.indexOf("PlateDigits") !== -1 )) 
                                            {
                                            var oContext = oInputControl.getBindingContext();
                                            if (oContext) {
                                                var oData = oContext.getObject();
                                                var bIsKSA = false;

                                                for (var key in oData) {
                                                    if (key.indexOf("PlateTyp") !== -1 && typeof oData[key] === "string") {
                                                        if (oData[key].toUpperCase().indexOf("KSA") !== -1) {
                                                            bIsKSA = true;
                                                            break;
                                                        }
                                                    }
                                                }

                                                // --- UX LOGIC START ---
                                                if (bIsKSA) {
                                                    var sVal = oInputControl.getValue();
                                                    var sNewVal = sVal.replace(/\D/g, ''); // Remove letters
                                                    
                                                    var bExceedsLength = false;
                                                    var bContainsLetters = (sVal !== sNewVal); // Detect if letter was typed

                                                    // 1. Check if they tried to type more than 4 digits
                                                    if (sNewVal.length > 4) {
                                                        sNewVal = sNewVal.substring(0, 4);
                                                        bExceedsLength = true; 
                                                    }

                                                    // 2. Fiori Value State Logic (Red box + message)
                                                    if (bContainsLetters || bExceedsLength) {
                                                        
                                                        // Force UI5 to immediately clear invalid characters from screen
                                                        oEvent.target.value = sNewVal;
                                                        oInputControl.setValue(sNewVal);

                                                        if (oInputControl.setValueState) {
                                                            oInputControl.setValueState("Error");
                                                            
                                                            // Show exact error message
                                                            if (bContainsLetters && bExceedsLength) {
                                                                oInputControl.setValueStateText("Only numbers are allowed (Max 4 digits).");
                                                            } else if (bContainsLetters) {
                                                                oInputControl.setValueStateText("Only numeric digits are allowed.");
                                                            } else {
                                                                oInputControl.setValueStateText("Cannot exceed 4 digits for KSA plates.");
                                                            }
                                                            
                                                            // Auto-clear error message after 3 seconds
                                                            setTimeout(function() {
                                                                if (oInputControl && !oInputControl.bIsDestroyed && oInputControl.setValueState) {
                                                                    oInputControl.setValueState("None");
                                                                    oInputControl.setValueStateText("");
                                                                }
                                                            }, 3000);
                                                        }
                                                    } else {
                                                        // Ensure box is normal if input is valid
                                                        if (oInputControl.setValueState) {
                                                            oInputControl.setValueState("None");
                                                            oInputControl.setValueStateText("");
                                                        }
                                                    }
                                                } else {
                                                    // Ensure non-KSA plates clear any leftover error states
                                                    if (oInputControl.setValueState) {
                                                        oInputControl.setValueState("None");
                                                        oInputControl.setValueStateText("");
                                                    }
                                                }
                                                // --- UX LOGIC END ---
                                            }
                                        }
                                    });
                                    $view.data("plateEventAttached", true);
                                }
                            } catch (err) {
                                console.error("Error in plateRestriction event handler:", err);
                            }
                        }
                    }); 
                } catch (err) {
                    console.error("Error in onInit override:", err);
                }
            },

            routing: {
                onAfterBinding: function (oBindingContext) {
                    var oView = this.base.getView();
                    var oAppModel = oView.getModel();
                    
                    if (!oAppModel) return;

                    var oViolatorModel = oView.getModel("violator");
                    if (!oViolatorModel) {
                        oViolatorModel = new JSONModel({ isVisible: false });
                        oView.setModel(oViolatorModel, "violator");
                    }

                    // A) Auth Check
                    if (!this._bAuthChecked) {
                        this._bAuthChecked = true;
                        var oListBinding = oAppModel.bindList("/authInfo", null, null, null, { $$groupId: "$direct" });
                        
                        oListBinding.requestContexts(0, 1).then(function (aContexts) {
                            if (aContexts && aContexts.length > 0) {
                                var oUserData = aContexts[0].getObject();
                                if (oUserData.IsAdmin === true) {
                                    oView.addStyleClass("employeeMode");
                                    document.body.classList.add("employeeMode");
                                } else {
                                    oView.removeStyleClass("employeeMode");
                                    document.body.classList.remove("employeeMode");
                                }
                            }
                        }).catch(function (err) {
                            console.error("Auth check fetch failed:", err);
                        });
                    }

                    // B) Violator Detail Fetch
                    if (oBindingContext && oBindingContext.getPath().indexOf("/header") !== -1) {
                        oBindingContext.requestProperty("JhahId").then(function (sJhahId) {
                            
                            if (sJhahId && sJhahId.trim() !== "") {
                                var sPath = "/employee('" + sJhahId + "')"; 
                                
                                var oContext = oAppModel.bindContext(sPath, null, { 
                                    "$$groupId": "$direct"
                                });
                                
                                oContext.requestObject().then(function(oData) {
                                    if (oData && oViolatorModel) {
                                        oViolatorModel.setData(Object.assign({}, oData, { isVisible: true }));
                                    }
                                }).catch(function(err) {
                                    console.error("Failed to fetch employee details:", err);
                                    if (oViolatorModel) oViolatorModel.setData({ isVisible: false });
                                });
                            } else {
                                if (oViolatorModel) oViolatorModel.setData({ isVisible: false });
                            }
                        }).catch(function(err) {
                            console.error("Failed to read JhahId property:", err);
                            if (oViolatorModel) oViolatorModel.setData({ isVisible: false });
                        });
                    }
                }
            }
        }
    });
});