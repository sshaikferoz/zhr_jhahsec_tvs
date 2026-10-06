sap.ui.define([
    "sap/m/MessageToast"
], function (MessageToast) {
    "use strict";

    return {
        navigateToMaintainLocation: function (oEvent) {
            var oCrossAppNavigator = sap.ushell && sap.ushell.Container && sap.ushell.Container.getService("CrossApplicationNavigation");
            if (oCrossAppNavigator) {
                oCrossAppNavigator.toExternal({
                    target: {
                        semanticObject: "MaintLocnType",
                        action: "manage"
                    }
                });
            } else {
                MessageToast.show("Cross-App Navigation is not supported in this environment.");
            }
        },

        navigateToMaintainViolationType: function (oEvent) {
            var oCrossAppNavigator = sap.ushell && sap.ushell.Container && sap.ushell.Container.getService("CrossApplicationNavigation");
            if (oCrossAppNavigator) {
                oCrossAppNavigator.toExternal({
                    target: {
                        semanticObject: "MaintViolType",
                        action: "manage"
                    }
                });
            } else {
                MessageToast.show("Cross-App Navigation is not supported in this environment.");
            }
        }
    };
});