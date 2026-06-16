sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"com/jhah/zhrjhahsectvs/test/integration/pages/headerList",
	"com/jhah/zhrjhahsectvs/test/integration/pages/headerObjectPage",
	"com/jhah/zhrjhahsectvs/test/integration/pages/evidenceObjectPage"
], function (JourneyRunner, headerList, headerObjectPage, evidenceObjectPage) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('com/jhah/zhrjhahsectvs') + '/test/flp.html#app-preview',
        pages: {
			onTheheaderList: headerList,
			onTheheaderObjectPage: headerObjectPage,
			onTheevidenceObjectPage: evidenceObjectPage
        },
        async: true
    });

    return runner;
});

