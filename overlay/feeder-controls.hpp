// Supported Feeder releases document a live cfg reload every 60 delivered frames. This
// adapter edits that file, not private memory. Readback here is FILE readback,
// not confirmation of GPU execution. RenoDX NR remains a separate connection.
#pragma once
#include <fstream>
namespace feed_live {
struct compatibility {
    const char *version;
    DWORD size;
    const unsigned char *hash;
};
inline const compatibility *profile(HMODULE module) {
    static const unsigned char v012[] = {0x06,0x6e,0xec,0x8c,0x79,0x7d,0xf2,0xd6,0x56,0xf2,0xab,0x23,0x24,0x27,0x89,0x21,0xb1,0xdd,0x6e,0x91,0x16,0xc9,0x94,0x52,0x94,0xf4,0xa0,0x0f,0x7f,0xec,0x60,0x8a};
    static const unsigned char v013[] = {0xf0,0x12,0x33,0xa4,0x4f,0x46,0xd7,0x70,0xcf,0xce,0x58,0xb6,0xcb,0x97,0x50,0x31,0x10,0x11,0xee,0x38,0x19,0x68,0x56,0xe9,0x06,0x80,0x8b,0xee,0x87,0x56,0xbe,0xda};
    static const unsigned char v014[] = {0x03,0x54,0x5e,0xdc,0xca,0x11,0x53,0xf2,0x7c,0xec,0xcb,0x7a,0xde,0x8c,0xd9,0xa0,0x42,0x03,0x70,0x74,0x8a,0xe5,0x4e,0x55,0xe8,0x31,0x19,0xbe,0xc0,0x50,0x75,0xf1};
    static const compatibility builds[] = {
        {"0.12.0", 224256, v012},
        {"0.13.1-beta.1", 0, v013},
        {"0.14.0-beta.4", 0, v014}
    };
    for (const auto &build : builds) if (nr_probe::hash_matches(module, build.size, build.hash)) return &build;
    return nullptr;
}
struct field { const char *key, *name; uint32_t kind; float min,max,step,value=0; bool available=false; };
inline std::array<field,8> schema() { return {{
    {"enabled","Feeder enabled (original panel)",1,0,1,1},
    {"work_resolution","Work resolution (%)",0,50,100,1},
    {"work_sharpness","Work sharpness",0,0,1,.01f},
    {"mv_scale_x","Motion scale X",0,-2,2,.01f},
    {"mv_scale_y","Motion scale Y",0,-2,2,.01f},
    {"hdr","HDR contract",0,-1,1,1},
    {"depth_inverted","Depth convention (-1 auto, 0 normal, 1 inverted)",0,-1,1,1},
    {"work_upscale","Upscale (0 bilinear, 1 FSR1, 2 DLSS SR)",0,0,2,1}
}}; }
inline bool read(const std::wstring &path,std::string &out) {
    DWORD attr=GetFileAttributesW(path.c_str());
    if(attr==INVALID_FILE_ATTRIBUTES || (attr&(FILE_ATTRIBUTE_REPARSE_POINT|FILE_ATTRIBUTE_DIRECTORY)))return false;
    HANDLE file=CreateFileW(path.c_str(),GENERIC_READ,FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,nullptr);
    if(file==INVALID_HANDLE_VALUE)return false;
    DWORD size=GetFileSize(file,nullptr),n=0;bool ok=size>0&&size<=65536;
    if(ok){out.resize(size);ok=ReadFile(file,out.data(),size,&n,nullptr)&&n==size;}
    CloseHandle(file);return ok&&out.find('\0')==std::string::npos;
}
inline bool locate(const std::string &text,const char *key,size_t &start,size_t &end,float &value) {
    size_t pos=0;unsigned matches=0;
    while(pos<text.size()) {
        size_t e=text.find('\n',pos);if(e==std::string::npos)e=text.size();
        const auto line=text.substr(pos,e-pos);
        const auto eq=line.find('=');
        if(eq!=std::string::npos&&_stricmp(line.substr(0,eq).c_str(),key)==0){
            char tail;float v;
            if(sscanf(line.c_str()+eq+1,"%f %c",&v,&tail)!=1||!std::isfinite(v))return false;
            start=pos+eq+1;end=e;if(end>start&&text[end-1]=='\r')--end;value=v;++matches;
        }
        pos=e+1;
    }
    return matches==1;
}
struct controls {
    std::array<field,8> fields=schema();
    bool present=false,valid=false;HMODULE checked=nullptr;const compatibility *build=nullptr;
    std::wstring path;std::string reason="Feeder is not loaded";
    ULONGLONG poll_at=0;std::mutex mutex;
    void tick(bool dx11) {
        if(GetTickCount64()<poll_at)return;poll_at=GetTickCount64()+250;
        std::lock_guard<std::mutex> lock(mutex);
        for(auto &f:fields)f.available=false;
        HMODULE module=GetModuleHandleW(L"dlss5-feed.addon64");present=module!=nullptr;
        if(!module){checked=nullptr;build=nullptr;valid=false;reason="Feeder is not loaded";return;}
        if(module!=checked){
            checked=module;
            build=profile(module); valid=build!=nullptr;
            wchar_t file[32768]={};DWORD n=GetModuleFileNameW(module,file,32768);
            valid=valid&&n>0&&n<32768;path=file;
            if(valid)path=path.substr(0,path.find_last_of(L"\\/")+1)+L"dlss5-feed.cfg";
        }
        if(!valid){reason="Unsupported Feeder binary (supported: x64 v0.12.0, v0.13.1-beta.1, v0.14.0-beta.4)";return;}
        std::string text;if(!read(path,text)){reason="Feeder config unavailable; let Feeder initialize";return;}
        for(auto &f:fields){size_t a,b;float v;if(locate(text,f.key,a,b,v)&&v>=f.min&&v<=f.max&&(f.step!=1||std::floor(v)==v)){f.value=v;f.available=true;}}
        if(!dx11)for(size_t i:{1u,2u,7u})fields[i].available=false;
        reason="Feeder cfg reloads every 60 delivered frames. Work resolution/filter/sharpness: DX11 only. NR is separate.";
        // Feeder's outer FeedFrame returns before CfgReload when disabled.
        // A cfg-only off switch could not turn it back on. Keep its genuine
        // on/off control in the original page, never expose a one-way toggle.
        size_t mode_start,mode_end;float mode;
        if(!fields[0].available||fields[0].value!=1||!locate(text,"mode",mode_start,mode_end,mode)||(mode!=1&&mode!=2)){
            for(auto &f:fields)f.available=false;
            reason="Enable Feeder and select an active mode in its original page. Disabled/inert Feeder does not reload cfg.";
        }
        fields[0].available=false;
    }
    bool accept(uint32_t epoch,lab_live::command command) {
        std::lock_guard<std::mutex> lock(mutex);
#ifdef LAB_OVERLAY_SMOKE
        reshade::log::message(reshade::log::level::info,("LAB_FEEDER_COMMAND id="+std::to_string(command.id)+" epoch="+std::to_string(command.epoch)+" current="+std::to_string(epoch)).c_str());
#endif
        if(!present||!valid||command.epoch!=epoch||command.id<301||command.id>308||!std::isfinite(command.value))return false;
        auto &f=fields[command.id-301];float v=command.value;
        if(!f.available||command.kind!=f.kind||v<f.min||v>f.max||(f.step==1&&std::floor(v)!=v))return false;
        std::string before;if(!read(path,before))return false;
        size_t a,b;float old;if(!locate(before,f.key,a,b,old))return false;
        std::ostringstream number;number.imbue(std::locale::classic());number<<v;
        auto after=before;after.replace(a,b-a,number.str());
        // Keep the initial configuration recoverable. Never overwrite a prior backup.
        std::wstring backup=path+L".lab-original";
        if(!CopyFileW(path.c_str(),backup.c_str(),TRUE)&&GetLastError()!=ERROR_FILE_EXISTS)return false;
        const std::wstring temp=path+L".lab-"+std::to_wstring(GetCurrentProcessId())+L"-"+std::to_wstring(GetTickCount64())+L".tmp";
        HANDLE file=CreateFileW(temp.c_str(),GENERIC_WRITE,0,nullptr,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,nullptr);
        if(file==INVALID_HANDLE_VALUE)return false;
        DWORD n=0;bool ok=WriteFile(file,after.data(),DWORD(after.size()),&n,nullptr)&&n==after.size()&&FlushFileBuffers(file);CloseHandle(file);
        std::string current;if(ok)ok=read(path,current)&&current==before;
        if(ok)ok=MoveFileExW(temp.c_str(),path.c_str(),MOVEFILE_REPLACE_EXISTING|MOVEFILE_WRITE_THROUGH)!=0;
        if(!ok){DeleteFileW(temp.c_str());reason="Feeder cfg changed or write failed; retry";return false;}
        f.value=v;poll_at=0;
        reshade::log::message(reshade::log::level::info,("LAB_FEEDER_CFG_SAVED "+std::string(f.key)+"="+number.str()).c_str());return true;
    }
    std::string json()const {
        std::ostringstream out;out.imbue(std::locale::classic());const char *version=build?build->version:"unsupported";out<<",\"feedPresent\":"<<(present?"true":"false")<<",\"feedVersion\":"<<lab_live::quoted(version)<<",\"feedReason\":"<<lab_live::quoted(reason)<<",\"feedTools\":[";
        for(size_t i=0;i<fields.size();++i){auto &f=fields[i];if(i)out<<',';out<<"{\"id\":"<<301+i<<",\"kind\":"<<f.kind<<",\"effect\":\"Feeder "<<version<<"\",\"name\":"<<lab_live::quoted(f.name)<<",\"min\":"<<f.min<<",\"max\":"<<f.max<<",\"step\":"<<f.step<<",\"value\":"<<f.value<<",\"available\":"<<(present&&f.available?"true":"false")<<'}';}return out.str()+"]";
    }
};
}
