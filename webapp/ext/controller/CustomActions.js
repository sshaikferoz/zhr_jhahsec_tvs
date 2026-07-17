sap.ui.define([
    "sap/m/MessageToast"
], function (MessageToast) {
    "use strict";

    return {
        navigateToMaintainLocation: function (oContext, aSelectedContexts) {
            if (sap.ushell && sap.ushell.Container) {
                sap.ushell.Container.getServiceAsync("CrossApplicationNavigation").then(function (oCrossAppNav) {
                    oCrossAppNav.toExternal({
                        target: {
                            semanticObject: "MaintLocnType",
                            action: "manage"
                        }
                    });
                });
            } else {
                MessageToast.show("You need an SAP Fiori Launchpad to navigate to the Location Maintain app.");
            }
        },

        navigateToMaintainViolationType: function (oContext, aSelectedContexts) {
            if (sap.ushell && sap.ushell.Container) {
                sap.ushell.Container.getServiceAsync("CrossApplicationNavigation").then(function (oCrossAppNav) {
                    oCrossAppNav.toExternal({
                        target: {
                            semanticObject: "MaintViolType",
                            action: "manage"
                        }
                    });
                });
            } else {
                MessageToast.show("You need an SAP Fiori Launchpad to navigate to the Violation Type Maintain app.");
            }
        }
    };
});