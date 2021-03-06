var http = require('http');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var mongoq = require('mongoq');
var db = mongoq(process.env.MONGOLAB_URI || 'genexa');
var knox = require('knox');
var knox_settings = {};
if (process.env.AWS_KEY && process.env.AWS_SECRET && process.env.AWS_S3_BUCKET) {
    knox_settings.key = process.env.AWS_KEY;
    knox_settings.secret = process.env.AWS_SECRET;
    knox_settings.bucket = process.env.AWS_S3_BUCKET;
} else {
    knox_settings = require('../knox_settings.js').settings;
}

exports.thanks = function(req, res) {
    res.render('thanks');
};

exports.help = function(req, res) {
    res.render('help');
};

exports.upload_get = function(req, res) {
    var data = { url: '/img/logo.jpg' };
    res.render('upload', { layout: false, data: data });
};

exports.upload_post = function(req, res) {
    var data = {};
    var file = req.files.logo;
    if (file.type === 'image/jpeg' || file.type === 'image/pjpeg' || file.type === 'image/jpg' || file.type === 'image/png') {
        var client = knox.createClient(knox_settings);
        fs.readFile(file.path, function(err, buf) {
            var filename = crypto.createHash('md5').update((new Date()).getTime()+file.name).digest('hex')+(path.extname(file.name));
            var req = client.put('/logos/'+filename, {
                'Content-Length': buf.length,
                'Content-Type': file.type
            });
            req.on('response', function(s3res) {
                if (s3res.statusCode === 200) {
                    data.url = req.url;
                    data.image = '/logos/'+filename;
                    res.render('upload', { layout: false, data: data });
                }
            });
            req.end(buf);
        });

    } else {
        fs.unlink(file.path);
        data.url = '/img/logo-error.jpg';
        res.render('upload', { layout: false, data: data });
    }
};

var render = function(res, params) {
    var now = new Date();
    var date = now.getDate()+'/'+(now.getMonth()+1)+'/'+now.getFullYear();

    if (params) {
        res.render('home', params);
    } else {
        res.render('home', {
            logo: '',
            name: '',
            school: '',
            date: date,
            subject: '',
            teacher: '',
            period: '',
            file: '',
            questions: {}
        });
    }
};

exports.index = function(req, res) {
    render(res);
};

exports.doc = function(req, res) {
    var docs = db.collection('docs');
    var cursor = docs.findOne({ name: req.params.name });
    cursor.next(function(data) {
        if (data) {
            if (req.params.pdf === 'pdf') {
                if (data.logo) {
                    var local = data.logo.replace('/logos', './tmp');
                    var hreq = http.get({
                        host: 'genexa.s3.amazonaws.com',
                        port: 80,
                        path: data.logo
                    }, function(hres) {
                        var imagedata = '';
                        hres.setEncoding('binary');
                        hres.on('data', function(chunk) {
                            imagedata += chunk;
                        });
                        hres.on('end', function() {
                            fs.writeFile(local, imagedata, 'binary', function(err) {
                                if (!err) data.image = local;
                                res.contentType('application/pdf');
                                res.end(create_pdf(data), 'binary');
                                if (!err && data.image) fs.unlink(data.image);
                            });
                        });
                    });
                } else {
                    res.contentType('application/pdf');
                    res.end(create_pdf(data), 'binary');
                }
            } else {
                if (!data.questions) data.questions = {};
                if (data.logo) data.logo = 'http://genexa.s3.amazonaws.com'+data.logo;
                render(res, data);
            }
        } else {
            render(res);
        }
    }).fail(function(err) {
        res.contentType('text/html');
        res.send(err.message);
    });
};

exports.create = function(req, res) {
    var uniqueid = require('../helpers/id.js');
    var params = req.body;
    var now = new Date();

    params.name = uniqueid.encode(now.getTime());
    params.file = params.name+'.pdf';
    params.url = req.headers.host;

    var docs = db.collection('docs');
    docs.insert(params).fail(function(err) {
        delete params.file;
    });

    res.json(params);
};

var create_pdf = function(data) {
    var filename = data.name;
    var fontSize = 12;

    var PDFDocument = require('pdfkit');
    var doc = new PDFDocument({
        size: 'A4',
        layout: 'portrait',
        info: {
            'Creator': 'http://genexa.info/'
        }
    });

    doc.font('./public/fonts/Times-New-Roman.ttf').fontSize(12);
    doc.image('./public/img/watermark.png', 90, 50);
    doc.fontSize(14).text(data.school, { align: 'center' });
    doc.fontSize(fontSize).text(data.subject, { align: 'center' });
    doc.fontSize(fontSize).text(data.teacher, { align: 'center' });
    doc.fontSize(fontSize).text(data.period, { align: 'center' });
    doc.moveDown();
    doc.fontSize(fontSize).text('Nombre: ____________________________________   Grupo:__________'+'     '+data.date, { align: 'center' });
    doc.moveDown();
    doc.font('./public/fonts/Times-New-Roman-Bold.ttf').fontSize(fontSize).text('Instrucciones: Contesta según se pide.', { align: 'left' });
    doc.font('./public/fonts/Times-New-Roman.ttf');
    if (data.questions) {
        for (var i = 0 ; i < data.questions.length; i++) {
            var q = data.questions[i];
            doc.moveDown();
            doc.fontSize(fontSize).text((i+1)+'. '+q.question);
            switch(q.type) {
                case 'open':
                    doc.moveDown(2);
                    break;

                case 'options':
                    if (q.answers) {
                        var answers = '';
                        for (var j = 0; j < q.answers.length; j++) {
                            answers += String.fromCharCode(65+j).toLowerCase()+') '+q.answers[j]+'  ';
                        }
                        doc.fontSize(fontSize).text(answers);
                    }
                    break;

                case 'truefalse':
                    doc.fontSize(fontSize).text('a) Verdadero  b) Falso');
                    break;
            }
        }
    }

    if (data.image) {
        doc.image(data.image, 80, 72, { width: 90, height: 52 });
    }

    return doc.output();
};

exports.feedback = function(req, res) {
    var params = req.body;
    params.date = (new Date()).getTime();
    var docs = db.collection('feedback');
    docs.insert(params).fail(function(err) {
        if (err) throw err;
    });
    var data = {
        success: true
    };
    res.json(data);
};