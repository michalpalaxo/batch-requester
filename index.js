const rp = require("request-promise");
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const nconf = require('nconf')
const dateFns = require('date-fns');

nconf.file({file: 'config.json'});

const token = nconf.get('token');
const templateId = nconf.get('templateId');
const signatureId = nconf.get('signatureId');
const initialsId = nconf.get('initialsId');
const stampId = nconf.get('stampId');
const URI = nconf.get('URI');

const DYNAMIC_USER_POSITION = 4;

async function createRequests(data) {

    //load the template
    let template = await getTemplate(templateId);

    for (let i = 0; i < data.length; i++) {
        let item = data[i];

        let shareTo = item['Recipient email'];
        let annotations = [];
        let signatures = [];
        let signatureFields = [];
        let signatureData = [];

        let signEntity = await getSignEntityByOrder(DYNAMIC_USER_POSITION, template);
        let shareData = signEntity.shareData[0];

        signatureData.push(await generateShareTo("sign", shareTo, DYNAMIC_USER_POSITION, shareData));

        //add non-sign fields
        for (let j = 0; j < template.signEntities.length; j++) {
            let signEntity = template.signEntities[j];
            if (signEntity.shareType !== "sign") {
                let shareData = signEntity.shareData[0];
                signatureData.push(await generateShareTo(signEntity.shareType, signEntity.shareData[0].user.name, signEntity.order, shareData));
            }
        }

        //assign annotation, signatures and signature fields
        for (let j = 0; j < template.signFields.length; j++) {
            let field = template.signFields[j];

            let signEntity = await getSignEntityByRoleId(field.userRoleId, template);
            let shareData = signEntity.shareData[0];

            if (field.type === "annotation") {
                let fieldConfig = JSON.parse(field.config);
                if (item[fieldConfig.customId]) {
                    field.text = " " + item[fieldConfig.customId];
                } else {
                    field.text = "Null";
                }
                annotations.push(field);
            }

            if (field.type === "signature" || field.type === "initials" || field.type === "stamp") {
                if (field.order === 1) {
                    //fist position - I am signing
                    if (field.type === "signature") {
                        field.blob = signatureId;
                    }
                    if (field.type === "initials") {
                        field.blob = initialsId;
                    }
                    if (field.type === "stamp") {
                        field.blob = stampId;
                    }
                    signatures.push(field);
                } else if (field.order === DYNAMIC_USER_POSITION) {
                    //position of the user from the CSV
                    field.user = [shareTo];
                    signatureFields.push(field);
                } else {
                    //every other participant
                    signatureData.push(await generateShareTo("sign", field.user[0], field.order, shareData));
                    signatureFields.push(field);
                }
            }
        }
        //download template file
        await downloadFile(template.file);
        //upload new file from the template
        let uploadedFile = await uploadFile();
        //create a document
        let document = await createDocument("Document for " + shareTo, uploadedFile.file.fileId);
        //create the share
        await shareDocument(document.results[0].documentId, signatureData, annotations, signatures, signatureFields);
    }
}

async function getSignEntityByRoleId(userRoleId, template){
    return template.signEntities.find(signEntity => signEntity.userRoleId === userRoleId);
}

async function getSignEntityByOrder(order, template){
    return template.signEntities.find(signEntity => signEntity.order === order);
}


async function loadData() {
    const file = fs.readFileSync('data.csv', 'utf8');

    const rows = Papa.parse(file, {
        header: true,   // first row as keys
        dynamicTyping: true
    });

    return rows.data;
}

loadData().then(data => {
    return createRequests(data);
}).then(() => {
    console.log("Done");
}).catch(err => {
    console.error("Error:", err);
});


async function getTemplate(templateId) {
    let options = {
        method: 'GET',
        uri: URI + 'templates/' + templateId + '?token=' + token,
        json: true
    };

    return rp(options);
}


async function downloadFile(fileId) {
    let outputPath = "temp.pdf";

    let options = {
        method: 'GET',
        uri: URI + 'files/loadFile/hash/' + fileId + '?token=' + token,
        encoding: null
    };

    try {
        const fileBuffer = await rp(options);
        const fileName = outputPath || path.join(__dirname, fileId + '.pdf'); // adjust extension
        fs.writeFileSync(fileName, fileBuffer);
        return fileName;
    } catch (err) {
        throw err;
    }
}

async function uploadFile() {

    let options = {
        method: 'POST',
        uri: URI + 'files/saveFile?token=' + token,
        formData: {
            file: {
                value: fs.createReadStream("temp.pdf"),
                options: {
                    filename: 'temp.pdf',
                    contentType: 'application/pdf'
                }
            },
            fileName: 'temp'
        },
        json: true
    };
    return rp(options);
}


async function createDocument(fileName, fileHash) {
    let options = {
        method: 'POST',
        uri: URI + 'documents?token=' + token,
        body: {
            body: {
                documentType: "d_default",
                documentTitle: fileName,
                pdfFile: {
                    content: fileHash
                }
            },
            definitionType: "ext",
            workflow: "wf_archive"
        },
        json: true
    };
    return rp(options);
}

async function generateShareTo(type, email, order, shareData) {
    let data = {
        "sharePurpose": type,
        "shareTo": email,
        "rights": [
            "print"
        ],
        "order": order
    };

    if(shareData.expirationTime){
        data.validUntil = await calculateFutureDate(shareData.expirationTime);
    }

    if(shareData.remindersEnabled){
        data.automaticReminder = {};
        data.automaticReminder.start = await calculateFutureDate(shareData.remindersStartDays);
        if(shareData.remindersStartDays.type === "time_span_span"){
            data.automaticReminder.intervalDays = shareData.remindersIntervalDays;
        }
    }

    if (shareData.message) {
        data.message = shareData.message;
    }

    const emailRegex = new RegExp(
        /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
    );

    //disable mail protection for users with username
    if (shareData.mailProtection && emailRegex.test(email.toLowerCase())) {
        data.mail = email;
    }

    return data;
}

async function calculateFutureDate(dateObj){
    if(dateObj.type === "time_span_time"){
        return dateObj.exactTime;
    }

    if(dateObj.type === "time_span_span"){
        let modifier = {};
        modifier[dateObj.timeSize.size + "s"] = dateObj.timeSize.span;
        return dateFns.add(new Date(), modifier);
    }

    return new Date();
}


async function shareDocument(documentId, data, annotations, signatures, signatureFields) {
    let options = {
        method: 'POST',
        uri: URI + 'share?token=' + token,
        body: {
            "objectType": "document",
            "id": documentId,
            "type": "d_default",
            "data": data,
            "force": false,
            "sequential": true,
            "signatureType": "image",
            "signatureProvider": "internal",
            "signatures": signatures,
            "annotations": annotations,
            "images": [],
            "signatureFields": signatureFields
        },
        json: true
    };
    return rp(options);
}