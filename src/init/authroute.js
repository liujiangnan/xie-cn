
const jwt = require('jsonwebtoken');

const url = require("url");
const fs = require("fs");
const ejs = require("ejs");

/**
 * Web请求路由（带权限）
 */

const renderFile = function(filepath,data){
  return new Promise(function(resolve,reject){
    ejs.renderFile(filepath, data, function(err, str) {
      if (err) {
        reject(err);
      }else{
        resolve(str);
      } 
    });
  });
}

let authroute = async function(app, secret, engine_dir) { 

  let router = require('koa-router')(); 

  //浏览器地址栏请求或刷新
  router.get('/', async function(ctx, next) {
    var host = ctx.headers['host'];
    let html = await renderFile(root_path + '/engine/index.ejs', { 'host': host });
    return ctx.body = html;
  });

  let fileNameArray = fs.readdirSync(engine_dir);
  fileNameArray.map(function(n) {
    var filepath = engine_dir + "/" + n;
    var stat = fs.lstatSync(filepath);
    if (stat && stat.isDirectory()) {
      console.log("正在装载'" + n + "'模块..");
      
      //模块入口路由
      router.get("/" + n, async function(ctx, next) {
        var host = ctx.headers['host']; 
        var params = "";
        if (ctx.request.query) {
          params = JSON.stringify(ctx.request.query);
        }
        let token = jwt.sign({ engine: n }, secret, {
          'expiresIn': 30 // 设置过期时间，单位是秒
        });
        let renderOption = getDeployOption("/",filepath,token);  
        try {
          let mdlService = require(filepath + '/src/'+renderOption.server);
          //判断模块是否开启了socketio，如果没开启，就不能靠socket来声明实例了
          //所以要提前声明实例并存放在session中 
          if(renderOption.token===null){ 
            ctx.session._engine_svc = new mdlService();
          }
        } catch (error) {
          console.log(error);
          let html = await renderFile(root_path + '/xie-cn/web/skyframe/error.ejs', {message: "非法访问"});
          return ctx.body = html; 
        } 
         
        renderOption.host = host; 
        renderOption.params = params;
        renderOption.engine = n;
        let html = await renderFile(root_path + '/xie-cn/web/skyframe/skyframe.ejs', renderOption);
        return ctx.body = html;
      });
      //各个子模块路由
      router.get("/" + n + "/:service", async function(ctx, next) {
        var host = ctx.headers['host']; 
        var params = "";
        if (ctx.request.query) {
          params = JSON.stringify(ctx.request.query);
        }
        var service = ctx.params.service;
        let token = jwt.sign({ engine: n }, secret, {
          'expiresIn': 30 // 设置过期时间，单位是秒
        });
        let renderOption = getDeployOption("/"+service,filepath,token); 
        try {
          let mdlService = require(filepath + '/src/'+renderOption.server);
          //判断模块是否开启了socketio，如果没开启，就不能靠socket来声明实例了
          //所以要提前声明实例并存放在session中
          if(renderOption.token===null){  
            ctx.session["_engine_svc_"+renderOption.server] = new mdlService(); 
          }
        } catch (error) {
          console.log(error);
          let html = await renderFile(root_path + '/xie-cn/web/skyframe/error.ejs', {message: "非法访问"});
          return ctx.body = html; 
        }  

        renderOption.host = host; 
        renderOption.params = params;
        renderOption.engine = n;
        
        let html = await renderFile(root_path + '/xie-cn/web/skyframe/skyframe.ejs', renderOption);
        return ctx.body = html; 
      });
 
      let __engine = async function(ctx, next) {  
        let svc = null;
        let service = ctx.request.body.service;
        let option = getDeployOption("/"+service,filepath);  

        ctx.request.body.engine = n;
        
        svc = netclient.getService(ctx); 
        if(!svc){ //如果没开启长连接的模块，是获取不到对应的service的 
          svc = ctx.session["_engine_svc_"+option.server]; 
        }  
        if (svc) {
          var method = ctx.request.body.method;
          var parms = ctx.request.body.parms;
          if (method === "getEjs") {
            return ctx.render(parms, {});
          } else {
            if (method === "init" && !svc["init"]) { 
              let index = option.index; 
              if(!index){
                index = filepath + "/web/index.ejs";
              }else {
                index = engine_dir+index;
              }
              return ctx.body = await renderFile(index,{});
            } else {
              try {
                await svc[method](ctx, parms);
              } catch (error) {
                console.log(error);
                let html = await renderFile(root_path + '/xie-cn/web/skyframe/error.ejs', {message: "服务器错误："+error});
                return ctx.body = html;  
              }
            }
          }
        } else {
          let html = await renderFile(root_path + '/xie-cn/web/skyframe/error.ejs', {message: "非法访问"});
          return ctx.body = html;   
        }
      };

      //模块交互路由
      router.post('/' + n + '/getView', __engine);

      //模块文件上传路由
      router.post('/' + n + '/getFile', async function(ctx, next) {  
        for(let key in ctx.request.body.fields){
          ctx.request.body[key] = ctx.request.body.fields[key];
        }
        await __engine(ctx, next); 
      });

      console.log("模块'" + n + "'装载完成..");
    }
  });
  app.use(router.routes(), router.allowedMethods());
  console.log("所有模块装载完成...");
}

function isOpenSocketIo(key,filepath){
  try {
    let deploy = require(filepath + "/deploy.js")[key];
    let res = deploy[key].socketio;
    return res===false?res:true;
  } catch (error) {
    console.log(error);
    return true;
  }
}

function getDefaultPage(key,filepath){
  try {
    let deploy = require(filepath + "/deploy.js")[key];
    return deploy[key].index;
  } catch (error) {
    console.log(error);
    return null;
  }
}

function setRenderOption(deploy,renderOption){
  if(deploy){
    if(deploy.title!==undefined){
      renderOption.title = deploy.title;
    }  
    if(deploy.socketio===false){
      renderOption.token = null;
    }
    //页面加载的时候，会自动嵌入页面的header中
    if(deploy.header){
      renderOption.header = root_path + '/engine/'+deploy.header;
    }
    //指定自定义的后台js文件
    if(deploy.service){
      renderOption.server = deploy.service.replace(".js",""); 
    }
    if(deploy.method){
      renderOption.method = deploy.method;
    }
    if(deploy.index){
      renderOption.index = deploy.index;
    }
  }
}

function getDeployOption(key,filepath,token){
  var packageJson = null;
  var deploy = null; 
  var renderOption = { 
    'server': key==="/"?'service':key.replace("/",""),
    'method': 'init', 
    'header': '',
    'title': '',
    'token': token
  }; 
  try{
    //这个文件不一定存在
    deploy = require(filepath + "/setting.js"); 
    setRenderOption(deploy,renderOption); //覆盖公共设置
    keyploy = deploy[key];
    setRenderOption(keyploy,renderOption); //覆盖路由设置
  }catch(e1){  
    console.log(e1);
    try{
      packageJson = require(filepath + "/package.json");
      renderOption.title = packageJson.description; 
    }catch(e){
      console.log(e);
      console.warn("模块"+key+"缺失package.json文件");
    }
  }
  return renderOption;
}
module.exports = authroute;